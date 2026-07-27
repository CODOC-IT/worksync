import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, CheckCircle2, ChevronDown, FileText, LoaderCircle, MessageSquare, Paperclip, Plus, Search, Send, Trash2, X } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { addDiscussionComment, createDiscussion, deleteDiscussionComment, editDiscussionComment, loadDiscussionThreads, setDiscussionResolved } from './projectChatRepository';
import { filterDiscussions, parseMentionIds } from './projectChatRules';
import { ChatAttachment, DISCUSSION_TYPES, DiscussionComment, DiscussionFilters, DiscussionThread, DiscussionType } from './projectChatTypes';

const emptyFilters: DiscussionFilters = { search: '', projectId: '', taskId: '', type: '', authorId: '', state: 'all', mentionedOnly: false, mineOnly: false, from: '', to: '', sort: 'active' };
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
  const [mentionOpen, setMentionOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const projectNames = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project.title])), [projects]);
  const taskNames = useMemo(() => Object.fromEntries(tasks.map((task) => [task.id, task.title])), [tasks]);
  const visibleThreads = useMemo(() => filterDiscussions(threads, filters, currentUser.id, projectNames, taskNames), [threads, filters, currentUser.id, projectNames, taskNames]);
  const selected = threads.find((thread) => thread.id === selectedId) || visibleThreads[0];
  const selectedProject = projects.find((project) => project.id === selected?.projectId);
  const canResolve = Boolean(selected && (currentRole === 'Admin' || (currentRole === 'Team_Lead' && selectedProject?.memberIds.includes(currentUser.id) && selectedProject.status === 'Active')));
  const projectTasks = tasks.filter((task) => task.projectId === filters.projectId);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const allowed = new Set(['application/pdf', 'text/plain', 'image/png', 'image/jpeg', 'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
    const accepted = Array.from(files).filter((file) => allowed.has(file.type) && file.size <= 10 * 1024 * 1024 && /^[\w. -]+$/.test(file.name));
    if (accepted.length !== files.length) setReplyError('Only safe PDF, text, image, and DOCX files up to 10 MB are allowed.');
    const processed = await Promise.all(accepted.map(async (file) => {
      let url: string | undefined;
      if (file.type.startsWith('image/')) {
        url = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
      }
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
      const comment = await addDiscussionComment(selected.id, { body, parentCommentId: replyTo, mentionIds: parseMentionIds(body, users), attachments });
      setThreads((current) => current.map((thread) => thread.id === selected.id ? { ...thread, comments: [...thread.comments, comment], updatedAt: comment.createdAt } : thread));
      setReplyText(''); setReplyTo(undefined); setAttachments([]); setMentionOpen(false);
    } catch (reason) { setReplyError(reason instanceof Error ? reason.message : 'Reply could not be sent.'); }
    finally { setSubmitting(false); }
  };

  const changeResolution = async () => {
    if (!selected) return;
    try { const updated = await setDiscussionResolved(selected.id, !selected.resolved); setThreads((current) => current.map((thread) => thread.id === updated.id ? { ...thread, ...updated } : thread)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update discussion state.'); }
  };

  return (
    <section className="mx-auto max-w-[1550px] space-y-4">
      <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div><h1 className="text-2xl font-bold text-white">Project Chats</h1><p className="mt-1 text-sm text-slate-400">Asynchronous project and task discussions, decisions, and follow-ups.</p></div>
        <div className="flex w-full gap-2 xl:w-auto"><label className="relative min-w-0 flex-1 xl:w-72"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input aria-label="Search discussions" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} className={`${inputClass} pl-9`} placeholder="Search discussions" /></label><button type="button" onClick={() => setComposerOpen(true)} className="glass-button-neon inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold"><Plus size={16} />Start Discussion</button></div>
      </header>

      <div className="glass-panel grid gap-2 p-3 lg:grid-cols-4 xl:grid-cols-7">
        <Select value={filters.projectId} onChange={(projectId) => setFilters({ ...filters, projectId, taskId: '' })} label="All projects">{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</Select>
        <Select value={filters.taskId} onChange={(taskId) => setFilters({ ...filters, taskId })} label="All tasks" disabled={!filters.projectId}>{projectTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</Select>
        <Select value={filters.type} onChange={(type) => setFilters({ ...filters, type })} label="All types">{DISCUSSION_TYPES.map((type) => <option key={type}>{type}</option>)}</Select>
        <Select value={filters.state} onChange={(state) => setFilters({ ...filters, state: state as DiscussionFilters['state'] })} label="Any state"><option value="unresolved">Unresolved</option><option value="resolved">Resolved</option></Select>
        <Select value={filters.sort} onChange={(sort) => setFilters({ ...filters, sort: sort as DiscussionFilters['sort'] })} label="Recently active"><option value="newest">Newest created</option><option value="oldest">Oldest created</option><option value="replies">Most replies</option></Select>
        <button type="button" onClick={() => setFilters({ ...filters, mineOnly: !filters.mineOnly })} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${filters.mineOnly ? 'border-cyan-400/50 bg-cyan-500/10 text-cyan-200' : 'border-white/10 text-slate-400'}`}>My Discussions</button>
        <button type="button" onClick={() => setFilters({ ...filters, mentionedOnly: !filters.mentionedOnly })} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${filters.mentionedOnly ? 'border-cyan-400/50 bg-cyan-500/10 text-cyan-200' : 'border-white/10 text-slate-400'}`}>Mentioned Me</button>
        <button type="button" onClick={() => setFilters(emptyFilters)} className="text-xs font-semibold text-slate-400 hover:text-cyan-300">Clear Filters</button>
      </div>

      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"><span>{error}</span><button type="button" onClick={() => void load()} className="rounded-lg border border-rose-300/30 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/15">Try again</button></div>}
      <div className="grid min-h-[650px] overflow-hidden rounded-xl border border-white/10 bg-slate-950/35 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside aria-label="Discussion list" className="border-b border-white/10 lg:border-b-0 lg:border-r">
          <div className="border-b border-white/10 px-4 py-3 text-sm font-bold text-white">Discussions <span className="ml-1 rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-400">{visibleThreads.length}</span></div>
          {loading ? <ListState label="Loading discussions…" /> : visibleThreads.length === 0 ? <ListState label={threads.length ? 'No discussions match these filters.' : 'No discussions yet. Start the first one.'} /> : <div className="max-h-[640px] overflow-y-auto">{visibleThreads.map((thread) => <ThreadPreview key={thread.id} thread={thread} active={selected?.id === thread.id} projectName={projectNames[thread.projectId]} taskName={taskNames[thread.taskId || '']} users={users} currentUserId={currentUser.id} onClick={() => setSelectedId(thread.id)} />)}</div>}
        </aside>
        <main className="min-w-0">{loading ? <ListState label="Loading selected discussion…" /> : selected ? <DiscussionPanel thread={selected} users={users} projectName={projectNames[selected.projectId]} taskName={taskNames[selected.taskId || '']} currentUserId={currentUser.id} canResolve={canResolve} onResolve={() => void changeResolution()} onReply={(commentId) => { setReplyTo(commentId); document.getElementById('discussion-reply')?.focus(); }} onDelete={async (comment) => { try { const updated = await deleteDiscussionComment(comment.id); setThreads((items) => items.map((thread) => thread.id === selected.id ? { ...thread, comments: thread.comments.map((item) => item.id === updated.id ? updated : item) } : thread)); } catch (reason) { setReplyError(reason instanceof Error ? reason.message : 'Could not delete comment.'); } }} /> : <ListState label="Select a discussion to read it." />}
          {selected && <form onSubmit={submitReply} className="border-t border-white/10 bg-black/10 p-4"><div className="mb-2 flex items-center justify-between text-xs text-slate-400"><span>{replyTo ? 'Replying to a comment' : 'Add a reply'}</span>{replyTo && <button type="button" onClick={() => setReplyTo(undefined)} className="text-cyan-300">Cancel reply</button>}</div><textarea id="discussion-reply" value={replyText} onChange={(event) => { setReplyText(event.target.value); setMentionOpen(event.target.value.endsWith('@')); }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submitReply(event as unknown as FormEvent); } }} className={`${inputClass} min-h-24 resize-y`} maxLength={5000} placeholder="Reply… Use @ to mention a project member. Shift+Enter for a new line." />{mentionOpen && <MentionList users={users.filter((user) => selectedProject?.memberIds.includes(user.id) && user.status !== 'inactive')} onPick={(user) => { setReplyText((text) => `${text.slice(0, -1)}@${user.name} `); setMentionOpen(false); }} />}<div className="mt-2 flex items-center justify-between gap-3"><div><input ref={fileRef} className="hidden" type="file" multiple onChange={(event) => { void addFiles(event.target.files); }} /><button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-300"><Paperclip size={14} />Attach</button>{attachments.map((file) => { const isImage = file.mimeType.startsWith('image/') && file.url; return isImage ? (<span key={file.id} className="ml-2 inline-flex items-center gap-1 rounded bg-white/5 px-1 py-1 text-[10px] text-slate-300"><img src={file.url} alt={file.name} className="h-8 w-8 rounded object-cover" /><span className="truncate max-w-24">{file.name}</span><button type="button" onClick={() => setAttachments((items) => items.filter((item) => item.id !== file.id))}><X size={11} /></button></span>) : (<span key={file.id} className="ml-2 inline-flex items-center gap-1 rounded bg-white/5 px-2 py-1 text-[10px] text-slate-300">{file.name}<button type="button" onClick={() => setAttachments((items) => items.filter((item) => item.id !== file.id))}><X size={11} /></button></span>); })}</div><button disabled={submitting} className="glass-button-neon inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50">{submitting ? <LoaderCircle className="animate-spin" size={14} /> : <Send size={14} />}Reply</button></div>{replyError && <p role="alert" className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{replyError}</p>}</form>}
        </main>
      </div>
      {composerOpen && <NewDiscussionDialog projects={projects} tasks={tasks} users={users} currentUser={currentUser} onClose={() => setComposerOpen(false)} onCreated={(thread) => { setThreads((items) => [thread, ...items]); setSelectedId(thread.id); setComposerOpen(false); }} />}
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

const DiscussionPanel: React.FC<any> = ({ thread, users, projectName, taskName, currentUserId, canResolve, onResolve, onReply, onDelete }) => <div className="p-5"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 pb-4"><div><div className="flex items-center gap-2 text-xs text-cyan-300"><span>{projectName}</span>{taskName && <><span>·</span><span>{taskName}</span></>}</div><h2 className="mt-2 text-xl font-bold text-white">{thread.title}</h2><span className={`mt-2 inline-block rounded-full border px-2 py-1 text-[10px] font-bold ${thread.resolved ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-amber-400/30 bg-amber-500/10 text-amber-200'}`}>{thread.resolved ? 'Resolved' : 'Unresolved'} · {thread.type}</span></div>{canResolve && <button type="button" onClick={onResolve} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/5">{thread.resolved ? 'Reopen discussion' : 'Resolve discussion'}</button>}</div><div className="divide-y divide-white/10">{thread.comments.map((comment: DiscussionComment) => { const author = users.find((user: any) => user.id === comment.authorId); return <article key={comment.id} className={`py-5 ${comment.parentCommentId ? 'ml-5 border-l border-cyan-400/20 pl-4' : ''}`}><div className="flex gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-[10px] font-bold text-cyan-200">{initials(author?.name)}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 text-xs"><strong className="text-slate-100">{author?.name || 'Unknown user'}</strong><span className="text-slate-500">{formatTime(comment.createdAt)}</span>{comment.editedAt && <span className="text-slate-500">edited</span>}</div>{comment.deletedAt ? <p className="mt-2 italic text-sm text-slate-500">This comment was deleted.</p> : <><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{comment.body}</p>{comment.attachments.map((file) => renderAttachment(file))}<div className="mt-2 flex gap-3">{!comment.parentCommentId && <button type="button" onClick={() => onReply(comment.id)} className="text-xs font-semibold text-cyan-300">Reply</button>}{comment.authorId === currentUserId && <button type="button" onClick={() => onDelete(comment)} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-rose-300"><Trash2 size={12} />Delete</button>}</div></>}</div></div></article>; })}</div></div>;
const MentionList: React.FC<any> = ({ users, onPick }) => <div role="listbox" className="mt-1 max-h-36 overflow-y-auto rounded-lg border border-cyan-400/20 bg-slate-900 p-1">{users.map((user: any) => <button key={user.id} type="button" role="option" onClick={() => onPick(user)} className="block w-full rounded px-2 py-1.5 text-left text-xs text-slate-200 hover:bg-white/10">@{user.name} <span className="text-slate-500">{user.title}</span></button>)}</div>;
const NewDiscussionDialog: React.FC<any> = ({ projects, tasks, users, currentUser, onClose, onCreated }) => { const [form, setForm] = useState({ projectId: '', taskId: '', title: '', type: 'General' as DiscussionType, body: '' }); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const eligibleTasks = tasks.filter((task: any) => task.projectId === form.projectId); const submit = async (event: FormEvent) => { event.preventDefault(); const body = form.body.trim(); if (!body) { setError('Write an initial message for the discussion.'); return; } setBusy(true); try { onCreated(await createDiscussion({ ...form, body, mentionIds: parseMentionIds(body, users), attachments: [] })); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not start discussion.'); } finally { setBusy(false); } }; return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><form onSubmit={submit} className="glass-panel-glow w-full max-w-2xl overflow-hidden"><div className="flex items-center justify-between border-b border-white/10 px-5 py-4"><div><h2 className="font-bold text-white">Start discussion</h2><p className="mt-1 text-xs text-slate-400">Create a focused project or task conversation.</p></div><button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button></div><div className="grid gap-4 p-5 md:grid-cols-2"><label className="text-xs font-semibold text-slate-300">Project *<select required value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value, taskId: '' })} className={`${inputClass} mt-1`}><option value="">Select project</option>{projects.map((project: any) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label><label className="text-xs font-semibold text-slate-300">Related task <select value={form.taskId} disabled={!form.projectId} onChange={(event) => setForm({ ...form, taskId: event.target.value })} className={`${inputClass} mt-1`}><option value="">No related task</option>{eligibleTasks.map((task: any) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><label className="text-xs font-semibold text-slate-300">Subject *<input required maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className={`${inputClass} mt-1`} /></label><label className="text-xs font-semibold text-slate-300">Discussion type *<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as DiscussionType })} className={`${inputClass} mt-1`}>{DISCUSSION_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label><label className="md:col-span-2 text-xs font-semibold text-slate-300">Initial message *<textarea required maxLength={5000} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} className={`${inputClass} mt-1 min-h-32`} placeholder="Describe the context, decision, blocker, or question. Use @ to mention project members." /></label>{error && <p role="alert" className="md:col-span-2 text-xs text-rose-300">{error}</p>}</div><div className="flex justify-end gap-2 border-t border-white/10 px-5 py-4"><button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300">Cancel</button><button disabled={busy} className="glass-button-neon rounded-lg px-4 py-2 text-sm font-bold disabled:opacity-50">{busy ? 'Starting…' : 'Start Discussion'}</button></div></form></div>; };
