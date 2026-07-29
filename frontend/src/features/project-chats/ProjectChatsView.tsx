import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, CheckCircle2, ChevronDown, FileText, LoaderCircle, MessageSquare, MoreHorizontal, Paperclip, Pencil, Plus, Search, Send, Trash2, X } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { fetchProjectMemberDirectory, ProjectMemberSummary } from '../projects/projectRepository';
import { addDiscussionComment, createDiscussion, deleteDiscussionComment, editDiscussionComment, loadDiscussionThreads, setDiscussionResolved } from './projectChatRepository';
import { filterDiscussions, getMentionTrigger, insertMention, MentionTrigger, parseMentionIds } from './projectChatRules';
import { ChatAttachment, DISCUSSION_TYPES, DiscussionComment, DiscussionFilters, DiscussionThread, DiscussionType } from './projectChatTypes';

const emptyFilters: DiscussionFilters = { search: '', projectId: '', taskId: '', type: '', authorId: '', state: '', mentionedOnly: false, mineOnly: false, from: '', to: '', sort: '' };
const inputClass = 'w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/10';
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
  const [projectMemberDirectories, setProjectMemberDirectories] = useState<Record<string, ProjectMemberSummary[]>>({});
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editError, setEditError] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
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
    let active = true;
    const loadMemberDirectories = async () => {
      const entries = await Promise.all(projects.map(async (project) => {
        try {
          const directory = await fetchProjectMemberDirectory(project.id);
          return [project.id, directory.members] as const;
        } catch {
          return [project.id, []] as const;
        }
      }));
      if (active) setProjectMemberDirectories(Object.fromEntries(entries));
    };
    void loadMemberDirectories();
    return () => { active = false; };
  }, [projects]);

  const projectNames = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project.title])), [projects]);
  const taskNames = useMemo(() => Object.fromEntries(tasks.map((task) => [task.id, task.title])), [tasks]);
  const visibleThreads = useMemo(() => filterDiscussions(threads, filters, currentUser.id, projectNames, taskNames), [threads, filters, currentUser.id, projectNames, taskNames]);
  const selected = threads.find((thread) => thread.id === selectedId) || visibleThreads[0];
  const selectedProject = projects.find((project) => project.id === selected?.projectId);
  const chatUsers = useMemo(() => {
    const byId = new Map<string, ProjectMemberSummary>();
    users.forEach((user) => byId.set(user.id, user));
    Object.values(projectMemberDirectories).flat().forEach((user) => byId.set(user.id, user));
    return Array.from(byId.values());
  }, [projectMemberDirectories, users]);
  const mentionUsers = useMemo(
    () => chatUsers.filter((user) =>
      user.status !== 'inactive' && Boolean(selectedProject?.memberIds.includes(user.id))
    ),
    [chatUsers, selectedProject]
  );
  const matchingMentionUsers = useMemo(() => {
    const query = mentionTrigger?.query.trim().toLocaleLowerCase() || '';
    return query
      ? mentionUsers.filter((user) => user.name.toLocaleLowerCase().includes(query))
      : mentionUsers;
  }, [mentionTrigger, mentionUsers]);
  const canResolve = Boolean(selected && (currentRole === 'Admin' || (currentRole === 'Team_Lead' && selectedProject?.memberIds.includes(currentUser.id) && selectedProject.status === 'Active')));
  const projectTasks = tasks.filter((task) => task.projectId === filters.projectId);

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
    setSubmitting(true); setReplyError('');
    try {
      const comment = await addDiscussionComment(selected.id, { body, parentCommentId: replyTo, mentionIds: parseMentionIds(body, mentionUsers), attachments });
      setThreads((current) => current.map((thread) => thread.id === selected.id ? { ...thread, comments: [...thread.comments, comment], updatedAt: comment.createdAt } : thread));
      setReplyText(''); setReplyTo(undefined); setAttachments([]); setMentionTrigger(null);
    } catch (reason) { setReplyError(reason instanceof Error ? reason.message : 'Reply could not be sent.'); }
    finally { setSubmitting(false); }
  };

  const changeResolution = async () => {
    if (!selected) return;
    try { const updated = await setDiscussionResolved(selected.id, !selected.resolved); setThreads((current) => current.map((thread) => thread.id === updated.id ? { ...thread, ...updated } : thread)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update discussion state.'); }
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
    <section data-project-chats className="mx-auto flex h-full min-h-0 max-w-[1550px] flex-col gap-4 overflow-hidden">
      <header className="flex shrink-0 flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div><h1 className="flex items-center gap-2 text-2xl font-bold text-white"><MessageSquare size={23} className="text-cyan-400" />Project Chats</h1><p className="mt-1 text-sm text-slate-400">Asynchronous project and task discussions, decisions, and follow-ups.</p></div>
        <div className="flex w-full gap-2 xl:w-auto"><label className="relative min-w-0 flex-1 xl:w-72"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input aria-label="Search discussions" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} className={`${inputClass} pl-9`} placeholder="Search discussions" /></label><button type="button" onClick={() => setComposerOpen(true)} className="glass-button-neon inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold"><Plus size={16} />Start Discussion</button></div>
      </header>

      <div className="glass-panel grid shrink-0 gap-2 p-3 lg:grid-cols-4 xl:grid-cols-7">
        <Select value={filters.projectId} onChange={(projectId) => setFilters({ ...filters, projectId, taskId: '' })} label="All projects">{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</Select>
        <Select value={filters.taskId} onChange={(taskId) => setFilters({ ...filters, taskId })} label="All tasks" disabled={!filters.projectId}>{projectTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</Select>
        <Select value={filters.type} onChange={(type) => setFilters({ ...filters, type })} label="All types">{DISCUSSION_TYPES.map((type) => <option key={type}>{type}</option>)}</Select>
        <Select value={filters.state} onChange={(state) => setFilters({ ...filters, state: state as DiscussionFilters['state'] })} label="Any state"><option value="unresolved">Unresolved</option><option value="resolved">Resolved</option></Select>
        <Select value={filters.sort} onChange={(sort) => setFilters({ ...filters, sort: sort as DiscussionFilters['sort'] })} label="Recently active"><option value="newest">Newest created</option><option value="oldest">Oldest created</option><option value="replies">Most replies</option></Select>
        <button type="button" onClick={() => setFilters({ ...filters, mineOnly: !filters.mineOnly })} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${filters.mineOnly ? 'border-cyan-400/50 bg-cyan-500/10 text-cyan-200' : 'border-white/10 text-slate-400'}`}>My Discussions</button>
        <button type="button" onClick={() => setFilters({ ...filters, mentionedOnly: !filters.mentionedOnly })} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${filters.mentionedOnly ? 'border-cyan-400/50 bg-cyan-500/10 text-cyan-200' : 'border-white/10 text-slate-400'}`}>Mentioned Me</button>
        <button type="button" onClick={() => setFilters(emptyFilters)} className="text-xs font-semibold text-slate-400 hover:text-cyan-300">Clear Filters</button>
      </div>

      {error && <div role="alert" className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"><span>{error}</span><button type="button" onClick={() => void load()} className="rounded-lg border border-rose-300/30 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/15">Try again</button></div>}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(160px,32%)_minmax(0,1fr)] overflow-hidden rounded-xl border border-white/10 bg-slate-950/35 lg:grid-cols-[360px_minmax(0,1fr)] lg:grid-rows-1">
        <aside aria-label="Discussion list" className="flex min-h-0 flex-col overflow-hidden border-b border-white/10 lg:border-b-0 lg:border-r">
          <div className="shrink-0 border-b border-white/10 px-4 py-3 text-sm font-bold text-white">Discussions <span className="ml-1 rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-400">{visibleThreads.length}</span></div>
          {loading ? <ListState label="Loading discussions…" /> : visibleThreads.length === 0 ? <ListState label={threads.length ? 'No discussions match these filters.' : 'No discussions yet. Start the first one.'} /> : <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{visibleThreads.map((thread) => <ThreadPreview key={thread.id} thread={thread} active={selected?.id === thread.id} projectName={projectNames[thread.projectId]} taskName={taskNames[thread.taskId || '']} users={chatUsers} currentUserId={currentUser.id} onClick={() => setSelectedId(thread.id)} />)}</div>}
        </aside>
        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {loading ? <ListState label="Loading selected discussion…" /> : selected ? <DiscussionPanel thread={selected} users={chatUsers} projectName={projectNames[selected.projectId]} taskName={taskNames[selected.taskId || '']} currentUserId={currentUser.id} currentRole={currentRole} canResolve={canResolve} onResolve={() => void changeResolution()} onReply={(commentId) => { setReplyTo(commentId); replyRef.current?.focus(); }} onEdit={startEdit} onDeleteRequest={startDelete} editingCommentId={editingCommentId} editText={editText} editError={editError} editSubmitting={editSubmitting} onEditTextChange={setEditText} onEditSubmit={submitEdit} onEditCancel={cancelEdit} /> : <ListState label="Select a discussion to read it." />}
          {selected && (
            <form onSubmit={submitReply} className="relative z-10 shrink-0 border-t border-white/10 bg-slate-950/80 p-3 backdrop-blur-md">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
                <span>{replyTo ? 'Replying to a comment' : 'Add a reply'}</span>
                {replyTo && <button type="button" onClick={() => setReplyTo(undefined)} className="font-semibold text-cyan-300 hover:text-cyan-200">Cancel reply</button>}
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
                  maxLength={5000}
                  placeholder="Write a reply… Type @ to mention a project member."
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <input ref={fileRef} className="hidden" type="file" multiple onChange={(event) => { void addFiles(event.target.files); }} />
                  <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-300"><Paperclip size={14} />Attach</button>
                  {attachments.map((file) => {
                    const isImage = file.mimeType.startsWith('image/') && file.url;
                    return isImage ? (
                      <span key={file.id} className="ml-2 inline-flex max-w-40 items-center gap-1 rounded bg-white/5 px-1 py-1 text-[10px] text-slate-300"><img src={file.url} alt={file.name} className="h-8 w-8 rounded object-cover" /><span className="truncate">{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments((items) => items.filter((item) => item.id !== file.id))}><X size={11} /></button></span>
                    ) : (
                      <span key={file.id} className="ml-2 inline-flex max-w-40 items-center gap-1 rounded bg-white/5 px-2 py-1 text-[10px] text-slate-300"><span className="truncate">{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments((items) => items.filter((item) => item.id !== file.id))}><X size={11} /></button></span>
                    );
                  })}
                </div>
                <button disabled={submitting} className="glass-button-neon inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50">{submitting ? <LoaderCircle className="animate-spin" size={14} /> : <Send size={14} />}Reply</button>
              </div>
              <p className="mt-1.5 text-[10px] text-slate-500">Enter to send · Shift+Enter for a new line</p>
              {replyError && <p role="alert" className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{replyError}</p>}
            </form>
          )}
        </main>
      </div>
      {composerOpen && <NewDiscussionDialog projects={projects} tasks={tasks} projectMemberDirectories={projectMemberDirectories} onClose={() => setComposerOpen(false)} onCreated={(thread) => { setThreads((items) => [thread, ...items]); setSelectedId(thread.id); setComposerOpen(false); }} />}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) cancelDelete(); }}>
          <div className="glass-panel w-full max-w-md overflow-hidden">
            <div className="border-b border-white/10 px-5 py-4">
              <h2 className="font-bold text-white">Delete message?</h2>
              <p className="mt-1 text-xs text-slate-400">The message content will no longer be visible to anyone. This cannot be undone.</p>
            </div>
            {deleteError && <p role="alert" className="mx-5 mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{deleteError}</p>}
            <div className="flex justify-end gap-2 px-5 py-4">
              <button type="button" onClick={cancelDelete} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">Cancel</button>
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

const Select: React.FC<{ value: string; onChange: (value: string) => void; label: string; children: React.ReactNode; disabled?: boolean }> = ({ value, onChange, label, children, disabled }) => <label className="relative"><select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={`${inputClass} appearance-none pr-8 text-xs`}><option value="">{label}</option>{children}</select><ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" /></label>;
const ListState: React.FC<{ label: string }> = ({ label }) => <div className="flex min-h-52 items-center justify-center px-6 text-center text-sm text-slate-500">{label}</div>;
const ThreadPreview: React.FC<any> = ({ thread, active, projectName, taskName, users, currentUserId, onClick }) => { const last = thread.comments.at(-1); const mentioned = thread.comments.some((comment: DiscussionComment) => comment.mentionIds.includes(currentUserId)); return <button type="button" onClick={onClick} className={`w-full border-b border-white/5 p-4 text-left transition ${active ? 'bg-cyan-500/10' : 'hover:bg-white/[0.035]'}`}><div className="flex items-start justify-between gap-2"><p className="line-clamp-2 font-semibold text-slate-100">{thread.title}</p>{thread.resolved ? <CheckCircle2 size={16} className="shrink-0 text-emerald-400" /> : <span className="shrink-0 rounded-full border border-amber-400/30 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">OPEN</span>}</div><p className="mt-1 truncate text-[11px] text-cyan-300">{projectName}{taskName ? ` · ${taskName}` : ''}</p><p className="mt-2 line-clamp-1 text-xs text-slate-400">{last?.deletedAt ? 'A comment was deleted' : last?.body || 'No comments yet'}</p><div className="mt-3 flex items-center justify-between text-[10px] text-slate-500"><span>{thread.comments.length} {thread.comments.length === 1 ? 'reply' : 'replies'}</span><span>{mentioned && <AtSign size={12} className="mr-1 inline text-cyan-300" />}{last ? formatTime(last.createdAt) : formatTime(thread.createdAt)}</span></div></button>; };
const renderAttachment = (file: ChatAttachment) => {
  const isImage = file.mimeType.startsWith('image/') && file.url;
  if (isImage) {
    return (
      <div key={file.id} className="mt-2 mr-2 inline-block">
        <img src={file.url} alt={file.name} className="max-h-48 max-w-64 rounded-lg border border-white/10 object-cover" />
        <p className="mt-1 text-[10px] text-slate-500">{file.name}</p>
      </div>
    );
  }
  return (
    <span key={file.id} className="mt-2 mr-2 inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300">
      <FileText size={12} />{file.name}
    </span>
  );
};

const DiscussionPanel: React.FC<any> = ({
  thread, users, projectName, taskName, currentUserId, currentRole, canResolve, onResolve,
  onReply, onEdit, onDeleteRequest, editingCommentId, editText, editError, editSubmitting,
  onEditTextChange, onEditSubmit, onEditCancel,
}) => {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpenId(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  useEffect(() => {
    const history = historyRef.current;
    if (history) history.scrollTop = history.scrollHeight;
  }, [thread.id, thread.comments.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-cyan-300"><span>{projectName}</span>{taskName && <><span>·</span><span>{taskName}</span></>}</div>
          <h2 className="mt-2 text-xl font-bold text-white">{thread.title}</h2>
          <span className={`mt-2 inline-block rounded-full border px-2 py-1 text-[10px] font-bold ${thread.resolved ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-400/30 bg-amber-500/10 text-amber-200'}`}>{thread.resolved ? 'Resolved' : 'Unresolved'} · {thread.type}</span>
        </div>
        {canResolve && <button type="button" onClick={onResolve} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/5">{thread.resolved ? 'Reopen discussion' : 'Resolve discussion'}</button>}
      </div>
      <div ref={historyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">
        <div className="divide-y divide-white/10">
        {thread.comments.map((comment: DiscussionComment) => {
          const author = users.find((user: any) => user.id === comment.authorId);
          const isMine = comment.authorId === currentUserId;
          const isAdmin = currentRole === 'Admin';
          const canEdit = isMine && !comment.deletedAt;
          const canDelete = (isMine || isAdmin) && !comment.deletedAt;
          const showMenu = canEdit || canDelete;
          const isEditing = editingCommentId === comment.id;

          return (
            <article key={comment.id} className={`group py-5 ${comment.parentCommentId ? 'ml-5 border-l border-cyan-400/20 pl-4' : ''}`}>
              <div className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[10px] font-bold text-cyan-200">{initials(author?.name)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <strong className="text-slate-100">{author?.name || 'Unknown user'}</strong>
                      <span className="text-slate-500">{formatTime(comment.createdAt)}</span>
                      {comment.editedAt && !comment.deletedAt && <span className="text-slate-500 italic">(edited)</span>}
                    </div>
                    {showMenu && !isEditing && (
                      <div className="relative opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity" ref={menuOpenId === comment.id ? menuRef : undefined}>
                        <button
                          type="button"
                          aria-label="Message actions"
                          onClick={() => setMenuOpenId(menuOpenId === comment.id ? null : comment.id)}
                          className="rounded-md border border-white/10 p-1 text-slate-500 hover:border-white/20 hover:text-slate-200 transition-colors"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        {menuOpenId === comment.id && (
                          <div className="absolute right-0 top-7 z-20 min-w-[130px] rounded-xl border border-white/10 bg-slate-900 py-1 shadow-xl" ref={menuRef}>
                            {canEdit && (
                              <button type="button" onClick={() => { setMenuOpenId(null); onEdit(comment); }} className="flex w-full items-center gap-2 px-3 py-2 text-xs text-slate-200 hover:bg-white/5">
                                <Pencil size={13} className="text-cyan-400" />Edit message
                              </button>
                            )}
                            {canDelete && (
                              <button type="button" onClick={() => { setMenuOpenId(null); onDeleteRequest(comment.id); }} className="flex w-full items-center gap-2 px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10">
                                <Trash2 size={13} />Delete{!isMine && ' (moderation)'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {comment.deletedAt ? (
                    <p className="mt-2 italic text-sm text-slate-500">This message was deleted.</p>
                  ) : isEditing ? (
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={editText}
                        onChange={(e) => onEditTextChange(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void onEditSubmit(comment.id); } if (e.key === 'Escape') onEditCancel(); }}
                        className="w-full rounded-lg border border-cyan-400/40 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-cyan-400/20 resize-y"
                        maxLength={5000}
                        rows={3}
                        autoFocus
                      />
                      {editError && <p role="alert" className="text-xs text-rose-300">{editError}</p>}
                      <div className="flex items-center gap-2">
                        <button type="button" disabled={editSubmitting} onClick={() => void onEditSubmit(comment.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-cyan-500 disabled:opacity-50">
                          {editSubmitting ? <LoaderCircle className="animate-spin" size={12} /> : null}Save
                        </button>
                        <button type="button" onClick={onEditCancel} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">Cancel</button>
                        <span className="text-[10px] text-slate-600">Esc to cancel · Enter to save</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{comment.body}</p>
                      {comment.attachments.map((file) => renderAttachment(file))}
                      <div className="mt-2 flex gap-3">
                        {!comment.parentCommentId && <button type="button" onClick={() => onReply(comment.id)} className="text-xs font-semibold text-cyan-300">Reply</button>}
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
    </div>
  );
};
const MentionList: React.FC<{ users: ProjectMemberSummary[]; onPick: (user: ProjectMemberSummary) => void }> = ({ users, onPick }) => (
  <div role="listbox" aria-label="Project members" className="absolute bottom-full left-0 z-30 mb-2 max-h-52 w-full overflow-y-auto rounded-xl border border-cyan-400/20 bg-slate-900 p-1.5 shadow-2xl">
    {users.length ? users.map((user) => (
      <button key={user.id} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => onPick(user)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/10">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[9px] font-bold text-cyan-200">{initials(user.name)}</span>
        <span className="min-w-0"><span className="block truncate font-semibold">@{user.name}</span><span className="block truncate text-[10px] text-slate-500">{user.title || user.department || user.role}</span></span>
      </button>
    )) : <p className="px-3 py-2 text-xs text-slate-500">No matching project member.</p>}
  </div>
);
const NewDiscussionDialog: React.FC<any> = ({
  projects, tasks, projectMemberDirectories, onClose, onCreated,
}) => {
  const [form, setForm] = useState({ projectId: '', taskId: '', title: '', type: 'General' as DiscussionType, body: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const eligibleTasks = tasks.filter((task: any) => task.projectId === form.projectId);
  const projectUsers: ProjectMemberSummary[] = projectMemberDirectories[form.projectId] || [];
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
    setBusy(true);
    setError('');
    try {
      onCreated(await createDiscussion({
        ...form,
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
      <form onSubmit={submit} className="glass-panel-glow w-full max-w-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div><h2 className="font-bold text-white">Start discussion</h2><p className="mt-1 text-xs text-slate-400">Create a focused project or task conversation.</p></div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <label className="text-xs font-semibold text-slate-300">Project *
            <select required value={form.projectId} onChange={(event) => { setForm({ ...form, projectId: event.target.value, taskId: '' }); setTrigger(null); }} className={`${inputClass} mt-1`}>
              <option value="">Select project</option>
              {projects.map((project: any) => <option key={project.id} value={project.id}>{project.title}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-300">Related task
            <select value={form.taskId} disabled={!form.projectId} onChange={(event) => setForm({ ...form, taskId: event.target.value })} className={`${inputClass} mt-1`}>
              <option value="">No related task</option>
              {eligibleTasks.map((task: any) => <option key={task.id} value={task.id}>{task.title}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-300">Subject *
            <input required maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className={`${inputClass} mt-1`} />
          </label>
          <label className="text-xs font-semibold text-slate-300">Discussion type *
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as DiscussionType })} className={`${inputClass} mt-1`}>
              {DISCUSSION_TYPES.map((type) => <option key={type}>{type}</option>)}
            </select>
          </label>
          <label className="relative md:col-span-2 text-xs font-semibold text-slate-300">Initial message *
            {trigger && <MentionList users={matchingUsers} onPick={selectMention} />}
            <textarea
              ref={bodyRef}
              required
              maxLength={5000}
              value={form.body}
              onChange={(event) => {
                setForm({ ...form, body: event.target.value });
                setTrigger(getMentionTrigger(event.target.value, event.target.selectionStart, projectUsers));
              }}
              onClick={(event) => setTrigger(getMentionTrigger(event.currentTarget.value, event.currentTarget.selectionStart, projectUsers))}
              className={`${inputClass} mt-1 min-h-32`}
              placeholder="Describe the context, decision, blocker, or question. Type @ to mention a project member."
            />
          </label>
          {error && <p role="alert" className="md:col-span-2 text-xs text-rose-300">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300">Cancel</button>
          <button disabled={busy} className="glass-button-neon rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50">{busy ? 'Starting…' : 'Start Discussion'}</button>
        </div>
      </form>
    </div>
  );
};
