import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, AtSign, ChevronDown, FileText, LoaderCircle, MessageSquare, MoreHorizontal, Paperclip, Pencil, Plus, Reply as ReplyIcon, Search, Send, Trash2, UsersRound, X } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { ProjectMemberSummary } from '../projects/projectRepository';
import { addDiscussionComment, createDiscussion, deleteDiscussionComment, editDiscussionComment, loadDiscussionThreads } from './projectChatRepository';
import {
  filterDiscussions,
  getMentionTrigger,
  getProjectMentionCandidates,
  insertMention,
  MentionTrigger,
  parseMentionIds
} from './projectChatRules';
import { ChatAttachment, DISCUSSION_TYPES, DiscussionComment, DiscussionFilters, DiscussionThread, DiscussionType } from './projectChatTypes';

const emptyFilters: DiscussionFilters = { search: '', projectId: '', taskId: '', type: '', authorId: '', mentionedOnly: false, mineOnly: false, from: '', to: '', sort: '' };
const COMMENT_MAX_LENGTH = 50;
const inputClass = 'project-chat-input w-full rounded-[10px] px-3 py-2 text-sm outline-none transition';
const formatTime = (date: string) => new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const initials = (name = '?') => name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();

export const ProjectChatsView: React.FC = () => {
  const { currentUser, currentRole, projects, tasks, users } = useApp();
  const [threads, setThreads] = useState<DiscussionThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState(emptyFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyTo, setReplyTo] = useState<string | undefined>();
  const [replyError, setReplyError] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editError, setEditError] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  const load = async () => {
    setLoading(true); setError('');
    try { const data = await loadDiscussionThreads(); setThreads(data); setSelectedId((id) => id || data[0]?.id || null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load discussions.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const projectId = query.get('projectId') || '';
    const taskId = query.get('taskId') || '';
    if (projectId || taskId) setFilters((current) => ({ ...current, projectId, taskId }));
  }, []);
  useEffect(() => {
    const selectedThread = threads.find((thread) => thread.id === selectedId);
    const project = projects.find((item) => item.id === selectedThread?.projectId);
    if (project?.status === 'Completed') {
      setSelectedId(null);
      setMobileConversationOpen(false);
      setReplyText('');
      setReplyTo(undefined);
      setError('This project has been completed and its discussions are now closed.');
      void load();
    }
  }, [projects, selectedId, threads]);

  const projectNames = useMemo(
    () => Object.fromEntries([
      ...threads.map((thread) => [thread.projectId, thread.projectName]),
      ...projects.map((project) => [project.id, project.title])
    ]),
    [projects, threads]
  );
  const taskNames = useMemo(
    () => Object.fromEntries([
      ...threads.filter((thread) => thread.taskId).map((thread) => [thread.taskId!, thread.taskName || '']),
      ...tasks.map((task) => [task.id, task.title])
    ]),
    [tasks, threads]
  );
  const visibleThreads = useMemo(() => filterDiscussions(threads.filter((thread) => projects.find((project) => project.id === thread.projectId)?.status !== 'Completed'), filters, currentUser.id, projectNames, taskNames), [threads, projects, filters, currentUser.id, projectNames, taskNames]);
  const selected = selectedId ? visibleThreads.find((thread) => thread.id === selectedId) : undefined;
  const chatUsers = useMemo(() => users.filter((user) => user.status === 'active') as ProjectMemberSummary[], [users]);
  const mentionUsers = useMemo(() => {
    if (!selected) return [];
    if (Array.isArray(selected.mentionableUserIds)) {
      const mentionableIds = new Set(selected.mentionableUserIds);
      return chatUsers.filter((user) => mentionableIds.has(user.id));
    }
    const project = projects.find((item) => item.id === selected.projectId);
    return getProjectMentionCandidates(
      chatUsers,
      project ? [...project.memberIds, project.teamLeadId] : []
    );
  }, [chatUsers, projects, selected]);
  const matchingMentionUsers = useMemo(() => {
    const query = mentionTrigger?.query.trim().toLocaleLowerCase() || '';
    return query
      ? mentionUsers.filter((user) => user.name.toLocaleLowerCase().includes(query))
      : mentionUsers;
  }, [mentionTrigger, mentionUsers]);
  const chatProjects = useMemo(() => {
    const options = new Map(projects.map((project) => [
      project.id,
      { id: project.id, title: project.title }
    ]));
    for (const thread of threads) {
      if (!options.has(thread.projectId)) {
        options.set(thread.projectId, { id: thread.projectId, title: thread.projectName });
      }
    }
    return Array.from(options.values());
  }, [projects, threads]);
  const projectTasks = useMemo(() => {
    const options = new Map(
      tasks
        .filter((task) => task.projectId === filters.projectId)
        .map((task) => [task.id, { id: task.id, title: task.title }])
    );
    for (const thread of threads) {
      if (thread.projectId === filters.projectId && thread.taskId && !options.has(thread.taskId)) {
        options.set(thread.taskId, { id: thread.taskId, title: thread.taskName || 'Project task' });
      }
    }
    return Array.from(options.values());
  }, [filters.projectId, tasks, threads]);
  const availableProjects = projects.filter((project) => project.status !== 'Completed');

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const allowed = new Set(['application/pdf', 'text/plain', 'image/png', 'image/jpeg', 'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
    const accepted = Array.from(files).filter((file) => allowed.has(file.type) && file.size <= 10 * 1024 * 1024 && /^[\w. -]+$/.test(file.name));
    if (accepted.length !== files.length) setReplyError('Only safe PDF, text, image, and DOCX files up to 10 MB are allowed.');
    const processed = await Promise.all(accepted.map(async (file) => {
      // Every accepted attachment (not just images) carries its real content as a base64 data
      // URL — the backend persists these bytes for real (collab.StoredFiles, content-addressed
      // on disk) and rejects any attachment with no readable content, so a non-image file
      // without this would simply fail to save.
      const url = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      return { id: `file-${Date.now()}-${file.name}`, name: file.name, mimeType: file.type, size: file.size, url };
    }));
    setAttachments((current) => [...current, ...processed]);
  };

  const submitReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || submitting) return;
    const body = replyText.trim();
    if (!body) { setReplyError('Write a reply before sending.'); return; }
    if (body.length > COMMENT_MAX_LENGTH) { setReplyError(`Replies cannot exceed ${COMMENT_MAX_LENGTH} characters.`); return; }
    setSubmitting(true); setReplyError('');
    try {
      const comment = await addDiscussionComment(selected.id, { body, parentCommentId: replyTo, mentionIds: parseMentionIds(body, mentionUsers), attachments });
      setThreads((current) => current.map((thread) => thread.id === selected.id ? { ...thread, comments: [...thread.comments, comment], updatedAt: comment.createdAt } : thread));
      setReplyText(''); setReplyTo(undefined); setAttachments([]); setMentionTrigger(null);
    } catch (reason) { setReplyError(reason instanceof Error ? reason.message : 'Reply could not be sent.'); }
    finally { setSubmitting(false); }
  };

  const startEdit = (comment: DiscussionComment) => {
    setEditingCommentId(comment.id);
    setEditText(comment.body);
    setEditError('');
  };

  const cancelEdit = () => { setEditingCommentId(null); setEditText(''); setEditError(''); };

  const submitEdit = async (commentId: string) => {
    if (editSubmitting) return;
    const body = editText.trim();
    if (!body) { setEditError('Message cannot be empty.'); return; }
    if (body.length > COMMENT_MAX_LENGTH) { setEditError(`Messages cannot exceed ${COMMENT_MAX_LENGTH} characters.`); return; }
    setEditSubmitting(true); setEditError('');
    try {
      const updated = await editDiscussionComment(commentId, body);
      setThreads((current) => current.map((thread) =>
        thread.id === selected?.id
          ? { ...thread, comments: thread.comments.map((c) => c.id === updated.id ? updated : c) }
          : thread
      ));
      cancelEdit();
    } catch (reason) {
      setEditError(reason instanceof Error ? reason.message : 'Could not save edit.');
    } finally { setEditSubmitting(false); }
  };

  const startDelete = (commentId: string) => {
    setDeleteConfirmId(commentId);
    setDeleteError('');
  };

  const cancelDelete = () => { setDeleteConfirmId(null); setDeleteError(''); };

  const confirmDelete = async (commentId: string) => {
    if (deleteSubmitting) return;
    setDeleteSubmitting(true); setDeleteError('');
    try {
      const updated = await deleteDiscussionComment(commentId);
      setThreads((items) => items.map((thread) =>
        thread.id === selected?.id
          ? { ...thread, comments: thread.comments.map((item) => item.id === updated.id ? updated : item) }
          : thread
      ));
      cancelDelete();
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : 'Could not delete message.');
    } finally { setDeleteSubmitting(false); }
  };

  const updateReplyMention = (value: string, cursor: number | null) => {
    setReplyText(value);
    setReplyError('');
    setMentionTrigger(getMentionTrigger(value, cursor ?? value.length, mentionUsers));
  };

  const selectReplyMention = (user: ProjectMemberSummary) => {
    if (!mentionTrigger) return;
    const next = insertMention(replyText, mentionTrigger, user.name);
    setReplyText(next.body);
    setMentionTrigger(null);
    window.requestAnimationFrame(() => {
      replyRef.current?.focus();
      replyRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  return (
    <section data-project-chats className="project-chat-shell mx-auto flex max-w-[1550px] flex-col gap-3 rounded-2xl p-3 md:p-4">
      <header className="flex shrink-0 flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="project-chat-heading flex items-center gap-2.5 text-2xl font-bold"><span className="project-chat-icon flex h-9 w-9 items-center justify-center rounded-xl"><MessageSquare size={19} /></span>Project Chats</h1>
          <p className="project-chat-secondary mt-1.5 text-sm">Keep project conversations, decisions, and follow-ups together.</p>
        </div>
        <div className="flex w-full gap-2 xl:w-auto">
          <label className="relative min-w-0 flex-1 xl:w-72"><Search size={15} className="project-chat-secondary pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" /><input aria-label="Search discussions" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} className={`${inputClass} h-10 pl-9`} placeholder="Search discussions" /></label>
          {currentRole !== 'HR' && (
            <button type="button" onClick={() => setComposerOpen(true)} className="project-chat-primary inline-flex h-10 shrink-0 items-center gap-2 rounded-[10px] px-4 text-sm font-bold"><Plus size={16} />Start Discussion</button>
          )}
        </div>
      </header>

      <div className="project-chat-toolbar flex shrink-0 flex-wrap items-center gap-2 rounded-xl p-2.5">
        <div className="min-w-36 flex-1"><Select value={filters.projectId} onChange={(projectId) => setFilters({ ...filters, projectId, taskId: '' })} label="All projects">{chatProjects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</Select></div>
        <div className="min-w-36 flex-1"><Select value={filters.taskId} onChange={(taskId) => setFilters({ ...filters, taskId })} label="All tasks" disabled={!filters.projectId}>{projectTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</Select></div>
        <div className="min-w-32 flex-1"><Select value={filters.type} onChange={(type) => setFilters({ ...filters, type })} label="All types">{DISCUSSION_TYPES.map((type) => <option key={type}>{type}</option>)}</Select></div>
        <div className="min-w-36 flex-1"><Select value={filters.sort} onChange={(sort) => setFilters({ ...filters, sort: sort as DiscussionFilters['sort'] })} label="Recently active"><option value="newest">Newest created</option><option value="oldest">Oldest created</option><option value="replies">Most replies</option></Select></div>
        <button type="button" aria-pressed={filters.mineOnly} onClick={() => setFilters({ ...filters, mineOnly: !filters.mineOnly })} className={`project-chat-filter-chip h-9 rounded-full px-3 text-xs font-semibold ${filters.mineOnly ? 'is-active' : ''}`}>My Discussions</button>
        <button type="button" aria-pressed={filters.mentionedOnly} onClick={() => setFilters({ ...filters, mentionedOnly: !filters.mentionedOnly })} className={`project-chat-filter-chip h-9 rounded-full px-3 text-xs font-semibold ${filters.mentionedOnly ? 'is-active' : ''}`}>Mentioned Me</button>
        <button type="button" onClick={() => setFilters(emptyFilters)} className="project-chat-clear px-2 py-1 text-xs font-semibold">Clear filters</button>
      </div>

      {error && <div role="alert" className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"><span>{error}</span><button type="button" onClick={() => void load()} className="rounded-lg border border-rose-300/30 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/15">Try again</button></div>}
      <div className="project-chat-layout grid h-[clamp(500px,72dvh,780px)] min-h-[500px] grid-cols-1 overflow-hidden rounded-2xl md:h-[clamp(580px,72dvh,780px)] md:min-h-[580px] lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside aria-label="Discussion list" className={`${mobileConversationOpen ? 'hidden lg:flex' : 'flex'} project-chat-sidebar min-h-0 flex-col overflow-hidden lg:border-r`}>
          <div className="project-chat-divider flex shrink-0 items-center justify-between border-b px-4 py-3">
            <span className="project-chat-heading text-sm font-bold">Discussions</span>
            <span className="project-chat-count rounded-full px-2 py-0.5 text-xs">{visibleThreads.length}</span>
          </div>
          {loading ? <ListState label="Gathering your discussions…" /> : visibleThreads.length === 0 ? <ListState label={threads.length ? 'Nothing matches those filters yet.' : 'No conversations yet. Start one when your team is ready.'} /> : <div className="project-chat-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2">{visibleThreads.map((thread) => <ThreadPreview key={thread.id} thread={thread} active={selected?.id === thread.id} projectName={projectNames[thread.projectId]} taskName={taskNames[thread.taskId || '']} users={chatUsers} currentUserId={currentUser.id} onClick={() => { setSelectedId(thread.id); setMobileConversationOpen(true); }} />)}</div>}
        </aside>
        <main className={`${mobileConversationOpen ? 'grid' : 'hidden lg:grid'} project-chat-conversation min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden`}>
          {loading ? <ListState label="Opening the conversation…" /> : selected ? <DiscussionPanel thread={selected} users={chatUsers} projectName={projectNames[selected.projectId]} taskName={taskNames[selected.taskId || '']} currentUserId={currentUser.id} currentRole={currentRole} onBack={() => setMobileConversationOpen(false)} onReply={(commentId) => { setReplyTo(commentId); replyRef.current?.focus(); }} onEdit={startEdit} onDeleteRequest={startDelete} editingCommentId={editingCommentId} editText={editText} editError={editError} editSubmitting={editSubmitting} onEditTextChange={setEditText} onEditSubmit={submitEdit} onEditCancel={cancelEdit} /> : <ListState label="Choose a discussion to join the conversation." />}
          {selected && (
            <form onSubmit={submitReply} className="project-chat-composer project-chat-divider relative z-10 m-3 mt-0 shrink-0 rounded-xl border p-3">
              <div className="project-chat-secondary mb-2 flex items-center justify-between text-xs">
                <span>{replyTo ? 'Replying to a comment' : 'Continue the conversation'}</span>
                {replyTo && <button type="button" onClick={() => setReplyTo(undefined)} className="project-chat-link font-semibold">Cancel reply</button>}
              </div>
              <div className="relative">
                {mentionTrigger && (
                  <MentionList users={matchingMentionUsers} onPick={selectReplyMention} />
                )}
                <textarea
                  ref={replyRef}
                  id="discussion-reply"
                  value={replyText}
                  onChange={(event) => updateReplyMention(event.target.value, event.target.selectionStart)}
                  onClick={(event) => updateReplyMention(event.currentTarget.value, event.currentTarget.selectionStart)}
                  onKeyUp={(event) => {
                    if (!['Enter', 'Escape'].includes(event.key)) {
                      setMentionTrigger(getMentionTrigger(event.currentTarget.value, event.currentTarget.selectionStart, mentionUsers));
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && mentionTrigger) {
                      event.preventDefault();
                      setMentionTrigger(null);
                    } else if (event.key === 'Enter' && mentionTrigger && !event.shiftKey) {
                      event.preventDefault();
                      if (matchingMentionUsers[0]) selectReplyMention(matchingMentionUsers[0]);
                    } else if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void submitReply(event as unknown as FormEvent);
                    }
                  }}
                  className={`${inputClass} min-h-16 max-h-32 resize-y pr-3`}
                  maxLength={COMMENT_MAX_LENGTH}
                  placeholder="Write a reply… Type @ to mention a project member."
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <input ref={fileRef} className="hidden" type="file" multiple onChange={(event) => { void addFiles(event.target.files); }} />
                  <button type="button" onClick={() => fileRef.current?.click()} className="project-chat-action inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs"><Paperclip size={14} />Attach</button>
                  {attachments.map((file) => {
                    const isImage = file.mimeType.startsWith('image/') && file.url;
                    return isImage ? (
                      <span key={file.id} className="project-chat-meta-pill ml-2 inline-flex max-w-40 items-center gap-1 rounded-lg px-1 py-1 text-[10px]"><img src={file.url} alt={file.name} className="h-8 w-8 rounded object-cover" /><span className="truncate">{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments((items) => items.filter((item) => item.id !== file.id))}><X size={11} /></button></span>
                    ) : (
                      <span key={file.id} className="project-chat-meta-pill ml-2 inline-flex max-w-40 items-center gap-1 rounded-lg px-2 py-1 text-[10px]"><span className="truncate">{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments((items) => items.filter((item) => item.id !== file.id))}><X size={11} /></button></span>
                    );
                  })}
                </div>
                <button disabled={submitting || !replyText.trim()} className="project-chat-primary inline-flex shrink-0 items-center gap-2 rounded-[10px] px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-45">{submitting ? <LoaderCircle className="animate-spin" size={14} /> : <Send size={14} />}Reply</button>
              </div>
              <div className="project-chat-secondary mt-1.5 flex items-center justify-between gap-3 text-[10px]"><span>Enter to send · Shift+Enter for a new line</span><span>{replyText.length}/{COMMENT_MAX_LENGTH}</span></div>
              {replyError && <p role="alert" className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{replyError}</p>}
            </form>
          )}
        </main>
      </div>
      {composerOpen && currentRole !== 'HR' && <NewDiscussionDialog projects={availableProjects} tasks={tasks} users={chatUsers} onClose={() => setComposerOpen(false)} onCreated={(thread) => { setThreads((items) => [thread, ...items]); setSelectedId(thread.id); setMobileConversationOpen(true); setComposerOpen(false); }} />}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) cancelDelete(); }}>
          <div className="project-chat-dialog w-full max-w-md overflow-hidden rounded-2xl">
            <div className="project-chat-divider border-b px-5 py-4">
              <h2 className="project-chat-heading font-bold">Delete message?</h2>
              <p className="project-chat-secondary mt-1 text-xs">The message content will no longer be visible to anyone. This cannot be undone.</p>
            </div>
            {deleteError && <p role="alert" className="mx-5 mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{deleteError}</p>}
            <div className="flex justify-end gap-2 px-5 py-4">
              <button type="button" onClick={cancelDelete} className="project-chat-action rounded-lg px-4 py-2 text-sm">Cancel</button>
              <button type="button" disabled={deleteSubmitting} onClick={() => void confirmDelete(deleteConfirmId)} className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-50">
                {deleteSubmitting ? <LoaderCircle className="animate-spin" size={14} /> : <Trash2 size={14} />}Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

const Select: React.FC<{ value: string; onChange: (value: string) => void; label: string; children: React.ReactNode; disabled?: boolean }> = ({ value, onChange, label, children, disabled }) => (
  <label className="relative block">
    <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={`${inputClass} h-9 appearance-none pr-8 text-xs`}>
      <option value="">{label}</option>{children}
    </select>
    <ChevronDown size={13} className="project-chat-secondary pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
  </label>
);

const ListState: React.FC<{ label: string }> = ({ label }) => (
  <div className="project-chat-secondary flex min-h-52 flex-1 items-center justify-center px-8 text-center text-sm leading-6">{label}</div>
);

const MemberInitials: React.FC<{ user?: ProjectMemberSummary; size?: 'sm' | 'md' }> = ({ user, size = 'md' }) => {
  const dimensions = size === 'sm' ? 'h-6 w-6 text-[8px]' : 'h-10 w-10 text-[10px]';
  return (
    <span aria-hidden="true" className={`${dimensions} project-chat-initials flex shrink-0 items-center justify-center rounded-full font-bold`}>{initials(user?.name)}</span>
  );
};

const ThreadPreview: React.FC<any> = ({ thread, active, projectName, taskName, users, currentUserId, onClick }) => {
  const last = thread.comments.at(-1);
  const mentioned = thread.comments.some((comment: DiscussionComment) => comment.mentionIds.includes(currentUserId));
  const participantIds = Array.from(new Set(thread.comments.map((comment: DiscussionComment) => comment.authorId)));
  const participants = participantIds.map((id) => users.find((user: ProjectMemberSummary) => user.id === id)).filter(Boolean);
  const replyCount = Math.max(0, thread.comments.length - 1);

  return (
    <button type="button" onClick={onClick} className={`project-chat-thread relative w-full rounded-xl p-3.5 text-left transition ${active ? 'is-active' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="project-chat-heading line-clamp-2 min-w-0 font-semibold leading-5">{thread.title}</p>
      </div>
      <p className="project-chat-context mt-1.5 truncate text-[11px] font-medium">{taskName || projectName}{taskName ? ` · ${projectName}` : ''}</p>
      <p className="project-chat-secondary mt-2 line-clamp-2 text-xs leading-5">{last?.deletedAt ? 'This message was deleted.' : last?.body || 'No messages yet.'}</p>
      <div className="project-chat-secondary mt-3 flex items-center justify-between gap-3 text-[10px]">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex -space-x-1.5">{participants.slice(0, 3).map((user: ProjectMemberSummary) => <MemberInitials key={user.id} user={user} size="sm" />)}</div>
          <span>{replyCount} {replyCount === 1 ? 'reply' : 'replies'}</span>
          {mentioned && <AtSign size={12} className="project-chat-context" aria-label="You were mentioned" />}
        </div>
        <span className="shrink-0">{last ? formatTime(last.createdAt) : formatTime(thread.createdAt)}</span>
      </div>
    </button>
  );
};
const renderAttachment = (file: ChatAttachment) => {
  const isImage = file.mimeType.startsWith('image/') && file.url;
  if (isImage) {
    return (
      <div key={file.id} className="mt-2 mr-2 inline-block">
        <img src={file.url} alt={file.name} className="project-chat-divider max-h-48 max-w-64 rounded-lg border object-cover" />
        <p className="project-chat-secondary mt-1 text-[10px]">{file.name}</p>
      </div>
    );
  }
  return (
    <span key={file.id} className="project-chat-meta-pill mt-2 mr-2 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs">
      <FileText size={12} />{file.name}
    </span>
  );
};

const DiscussionPanel: React.FC<any> = ({
  thread, users, projectName, taskName, currentUserId, currentRole, onBack,
  onReply, onEdit, onDeleteRequest, editingCommentId, editText, editError, editSubmitting,
  onEditTextChange, onEditSubmit, onEditCancel,
}) => {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const wasNearBottom = useRef(true);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpenId(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  useEffect(() => {
    const history = historyRef.current;
    if (!history) return;
    if (wasNearBottom.current || thread.comments.at(-1)?.authorId === currentUserId) {
      history.scrollTop = history.scrollHeight;
      setHasNewMessages(false);
    } else {
      setHasNewMessages(true);
    }
  }, [thread.id, thread.comments.length, currentUserId]);
  useEffect(() => {
    setHasNewMessages(false);
    wasNearBottom.current = true;
  }, [thread.id]);
  const participantCount = new Set(thread.comments.map((comment: DiscussionComment) => comment.authorId)).size;

  return (
    <div className="relative grid h-full min-h-0 grid-rows-[auto_minmax(280px,1fr)] overflow-hidden">
      <div className="project-chat-header project-chat-divider flex shrink-0 flex-wrap items-start justify-between gap-3 border-b px-4 py-4 md:px-5">
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onBack} className="project-chat-action mb-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold lg:hidden"><ArrowLeft size={14} />Back to Discussions</button>
          <h2 className="project-chat-heading break-words text-xl font-bold leading-7">{thread.title}</h2>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="project-chat-meta-pill rounded-full px-2 py-1 text-[10px] font-semibold">{thread.type}</span>
            <span className="project-chat-meta-pill max-w-56 truncate rounded-full px-2 py-1 text-[10px] font-semibold">{projectName}</span>
            {taskName && <span className="project-chat-meta-pill max-w-56 truncate rounded-full px-2 py-1 text-[10px] font-semibold">{taskName}</span>}
            <span className="project-chat-secondary inline-flex items-center gap-1 text-[10px]"><UsersRound size={12} />{participantCount} {participantCount === 1 ? 'participant' : 'participants'}</span>
            <span className="project-chat-secondary text-[10px]">Updated {formatTime(thread.updatedAt)}</span>
          </div>
        </div>
      </div>
      <div ref={historyRef} onScroll={(event) => {
        const element = event.currentTarget;
        wasNearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        if (wasNearBottom.current) setHasNewMessages(false);
      }} className="project-chat-scrollbar min-h-0 flex-1 overflow-x-hidden scroll-pb-6 overflow-y-auto overscroll-contain p-3 pb-6 md:p-4 md:pb-6">
        <div className="mx-auto max-w-5xl">
        {thread.comments.map((comment: DiscussionComment, index: number) => {
          const author = users.find((user: ProjectMemberSummary) => user.id === comment.authorId);
          const previous = thread.comments[index - 1] as DiscussionComment | undefined;
          const isMine = comment.authorId === currentUserId;
          const canEdit = isMine && !comment.deletedAt;
          const canDelete = isMine && !comment.deletedAt;
          const showMenu = canEdit || canDelete;
          const isEditing = editingCommentId === comment.id;
          const grouped = previous?.authorId === comment.authorId && previous?.parentCommentId === comment.parentCommentId;

          return (
            <article key={comment.id} className={`project-chat-message group max-w-4xl rounded-xl p-3.5 transition ${isMine ? 'is-mine' : ''} ${grouped ? 'mt-1.5' : 'mt-3.5'} ${comment.parentCommentId ? 'ml-4 md:ml-8' : ''}`}>
              <div className="flex gap-3">
                <MemberInitials user={author} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <strong className="project-chat-heading">{author?.name || 'Unknown user'}</strong>
                      <span className="project-chat-secondary">{formatTime(comment.createdAt)}</span>
                      {comment.editedAt && !comment.deletedAt && <span className="project-chat-secondary italic">(edited)</span>}
                    </div>
                    {showMenu && !isEditing && (
                      <div className="relative opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100" ref={menuOpenId === comment.id ? menuRef : undefined}>
                        <button
                          type="button"
                          aria-label="Message actions"
                          onClick={() => setMenuOpenId(menuOpenId === comment.id ? null : comment.id)}
                          className="project-chat-action rounded-lg p-1.5 transition-colors"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        {menuOpenId === comment.id && (
                          <div className="project-chat-menu absolute right-0 top-8 z-20 min-w-[140px] rounded-xl py-1.5" ref={menuRef}>
                            {canEdit && (
                              <button type="button" onClick={() => { setMenuOpenId(null); onEdit(comment); }} className="project-chat-menu-item flex w-full items-center gap-2 px-3 py-2 text-xs">
                                <Pencil size={13} />Edit message
                              </button>
                            )}
                            {canDelete && (
                              <button type="button" onClick={() => { setMenuOpenId(null); onDeleteRequest(comment.id); }} className="flex w-full items-center gap-2 px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10">
                                <Trash2 size={13} />Delete
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {comment.deletedAt ? (
                    <p className="project-chat-secondary mt-2 italic text-sm">This message was deleted.</p>
                  ) : isEditing ? (
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={editText}
                        onChange={(e) => onEditTextChange(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void onEditSubmit(comment.id); } if (e.key === 'Escape') onEditCancel(); }}
                        className={`${inputClass} w-full resize-y`}
                        maxLength={COMMENT_MAX_LENGTH}
                        rows={3}
                        autoFocus
                      />
                      {editError && <p role="alert" className="text-xs text-rose-300">{editError}</p>}
                      <div className="flex items-center gap-2">
                        <button type="button" disabled={editSubmitting} onClick={() => void onEditSubmit(comment.id)} className="project-chat-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50">
                          {editSubmitting ? <LoaderCircle className="animate-spin" size={12} /> : null}Save
                        </button>
                        <button type="button" onClick={onEditCancel} className="project-chat-action rounded-lg px-3 py-1.5 text-xs">Cancel</button>
                        <span className="project-chat-secondary text-[10px]">Esc to cancel · Enter to save · {editText.length}/{COMMENT_MAX_LENGTH}</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="project-chat-body mt-2 max-w-3xl break-words whitespace-pre-wrap text-sm leading-6">{comment.body}</p>
                      {comment.attachments.map((file) => renderAttachment(file))}
                      <div className="mt-2 flex gap-3">
                        {!comment.parentCommentId && <button type="button" onClick={() => onReply(comment.id)} className="project-chat-action inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold"><ReplyIcon size={13} />Reply</button>}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </article>
          );
          })}
        </div>
      </div>
      {hasNewMessages && <button type="button" onClick={() => {
        const history = historyRef.current;
        if (history) history.scrollTop = history.scrollHeight;
        wasNearBottom.current = true;
        setHasNewMessages(false);
      }} className="project-chat-new-messages absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs font-semibold">New messages ↓</button>}
    </div>
  );
};
const MentionList: React.FC<{ users: ProjectMemberSummary[]; onPick: (user: ProjectMemberSummary) => void }> = ({ users, onPick }) => (
  <div role="listbox" aria-label="Project members" className="project-chat-mention-list absolute bottom-full left-0 z-30 mb-2 max-h-52 w-full overflow-y-auto rounded-xl p-1.5">
    {users.length ? users.map((user) => (
      <button key={user.id} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => onPick(user)} className="project-chat-mention-option flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs">
        <MemberInitials user={user} size="sm" />
        <span className="min-w-0"><span className="project-chat-heading block truncate font-semibold">@{user.name}</span><span className="project-chat-secondary block truncate text-[10px]">{user.title || user.department || user.role}</span></span>
      </button>
    )) : <p className="project-chat-secondary px-3 py-2 text-xs">No matching eligible project member.</p>}
  </div>
);
const NewDiscussionDialog: React.FC<any> = ({
  projects, tasks, users, onClose, onCreated,
}) => {
  const [form, setForm] = useState({ projectId: '', taskId: '', title: '', type: 'General' as DiscussionType, body: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const eligibleTasks = tasks.filter((task: any) => task.projectId === form.projectId);
  const selectedProject = projects.find((project: any) => project.id === form.projectId);
  const projectUsers: ProjectMemberSummary[] = getProjectMentionCandidates(
    users,
    selectedProject ? [...selectedProject.memberIds, selectedProject.teamLeadId] : []
  );
  const matchingUsers = trigger?.query
    ? projectUsers.filter((user) => user.status !== 'inactive' && user.name.toLocaleLowerCase().includes(trigger.query.toLocaleLowerCase()))
    : projectUsers.filter((user) => user.status !== 'inactive');

  const selectMention = (user: ProjectMemberSummary) => {
    if (!trigger) return;
    const next = insertMention(form.body, trigger, user.name);
    setForm((current) => ({ ...current, body: next.body }));
    setTrigger(null);
    window.requestAnimationFrame(() => {
      bodyRef.current?.focus();
      bodyRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = form.body.trim();
    if (!body) {
      setError('Write an initial message for the discussion.');
      return;
    }
    if (body.length > COMMENT_MAX_LENGTH) {
      setError(`Messages cannot exceed ${COMMENT_MAX_LENGTH} characters.`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      onCreated(await createDiscussion({
        ...form,
        taskId: form.taskId || undefined,
        body,
        mentionIds: parseMentionIds(body, projectUsers),
        attachments: [],
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start discussion.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form onSubmit={submit} className="project-chat-dialog w-full max-w-2xl overflow-hidden rounded-2xl">
        <div className="project-chat-divider flex items-center justify-between border-b px-5 py-4">
          <div><h2 className="project-chat-heading font-bold">Start discussion</h2><p className="project-chat-secondary mt-1 text-xs">Create a focused project or task conversation.</p></div>
          <button type="button" onClick={onClose} aria-label="Close" className="project-chat-action rounded-lg p-2"><X size={18} /></button>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <label className="project-chat-body text-xs font-semibold">Project *
            <select required value={form.projectId} onChange={(event) => { setForm({ ...form, projectId: event.target.value, taskId: '' }); setTrigger(null); }} className={`${inputClass} mt-1`}>
              <option value="">Select project</option>
              {projects.map((project: any) => <option key={project.id} value={project.id}>{project.title}</option>)}
            </select>
          </label>
          <label className="project-chat-body text-xs font-semibold">Task <span className="project-chat-secondary font-normal">(optional)</span>
            <select value={form.taskId} disabled={!form.projectId} onChange={(event) => setForm({ ...form, taskId: event.target.value })} className={`${inputClass} mt-1`}>
              <option value="">No specific task</option>
              {eligibleTasks.map((task: any) => <option key={task.id} value={task.id}>{task.title}</option>)}
            </select>
            <span className="project-chat-secondary mt-1 block font-normal">Choose a task only if this discussion is about a specific task.</span>
          </label>
          <label className="project-chat-body text-xs font-semibold">Subject *
            <input required maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className={`${inputClass} mt-1`} />
          </label>
          <label className="project-chat-body text-xs font-semibold">Discussion type *
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as DiscussionType })} className={`${inputClass} mt-1`}>
              {DISCUSSION_TYPES.map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
          <label className="project-chat-body relative md:col-span-2 text-xs font-semibold">Initial message *
            {trigger && <MentionList users={matchingUsers} onPick={selectMention} />}
            <textarea
              ref={bodyRef}
              required
              maxLength={COMMENT_MAX_LENGTH}
              value={form.body}
              onChange={(event) => {
                setForm({ ...form, body: event.target.value });
                setTrigger(getMentionTrigger(event.target.value, event.target.selectionStart, projectUsers));
              }}
              onClick={(event) => setTrigger(getMentionTrigger(event.currentTarget.value, event.currentTarget.selectionStart, projectUsers))}
              className={`${inputClass} mt-1 min-h-32`}
              placeholder="Describe the context, decision, blocker, or question. Type @ to mention a project member."
            />
            <span className="project-chat-secondary mt-1 block text-right text-[10px] font-normal">{form.body.length}/{COMMENT_MAX_LENGTH}</span>
          </label>
          {error && <p role="alert" className="md:col-span-2 text-xs text-rose-300">{error}</p>}
        </div>
        <div className="project-chat-divider flex justify-end gap-2 border-t px-5 py-4">
          <button type="button" onClick={onClose} className="project-chat-action rounded-lg px-4 py-2 text-sm">Cancel</button>
          <button disabled={busy} className="project-chat-primary rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50">{busy ? 'Starting…' : 'Start Discussion'}</button>
        </div>
      </form>
    </div>
  );
};
