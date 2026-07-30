import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../../store/AppContext';
import { SearchableSelect } from '../../components/common/SearchableSelect';
import {
  Sparkles,
  FolderKanban,
  Copy,
  Save,
  RotateCcw,
  History,
  Search,
  X,
  FileText,
  Archive,
  RefreshCw,
  Check,
} from 'lucide-react';
import type { PromptVersion, SavedPromptDetail, PromptSummary } from '../../types';

type Tab = 'generate' | 'library';

const API_BASE = '/api/assistant';

const CATEGORIES = [
  { code: 'ProjectOverview', name: 'Project Overview', requiresProject: true, requiresTask: false, description: 'Generate an onboarding prompt explaining the entire project — tasks, milestones, members, and status — for new team members.' },
  { code: 'ProjectBreakdown', name: 'Project Breakdown', requiresProject: true, requiresTask: false, description: 'Break a project into phases, milestones, and deliverables.' },
  { code: 'TaskDescription', name: 'Task Description', requiresProject: true, requiresTask: true, description: 'Generate clear, detailed task descriptions.' },
  { code: 'AcceptanceCriteria', name: 'Acceptance Criteria', requiresProject: true, requiresTask: true, description: 'Define measurable conditions for when a task is considered complete.' },
  { code: 'CodeReview', name: 'Code Review', requiresProject: true, requiresTask: true, description: 'Analyze code for bugs, quality issues, security risks, and improvements.' },
  { code: 'TestCases', name: 'Test Cases', requiresProject: true, requiresTask: true, description: 'Generate test scenarios and cases for a feature or task.' },
  { code: 'Documentation', name: 'Documentation', requiresProject: true, requiresTask: false, description: 'Create technical or user-facing documentation.' },
];

const STYLES = [
  { value: 'Default', label: 'Default' },
  { value: 'Short', label: 'Short' },
  { value: 'Long', label: 'Long' },
  { value: 'Technical', label: 'Technical' },
  { value: 'Beginner', label: 'Beginner' },
  { value: 'Checklist', label: 'Checklist' },
  { value: 'StepByStep', label: 'Step by Step' },
];

async function apiFetch(path: string, options?: RequestInit) {
  const token = localStorage.getItem('worksync_auth_token');
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  let json: any;
  try {
    json = await res.json();
  } catch {
    const text = await res.text().catch(() => '');
    throw new Error(
      text
        ? `Server error (${res.status}): ${text.slice(0, 200)}`
        : `Server returned ${res.status} with empty body. Is the backend running?`
    );
  }
  if (!json.success) {
    if (res.status === 401) {
      throw new Error('Session expired. Please log out and log in again.');
    }
    throw new Error(json.message || `Request failed (${res.status})`);
  }
  return json.data;
}

export const AIAssistantView: React.FC = () => {
  const { addAIQueryLog, projects: contextProjects, tasks: contextTasks } = useApp();
  const [activeTab, setActiveTab] = useState<Tab>('generate');

  const [selectedProject, setSelectedProject] = useState('');
  const [selectedTask, setSelectedTask] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedStyle, setSelectedStyle] = useState('Default');
  const [additionalContext, setAdditionalContext] = useState('');
  const [generating, setGenerating] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [editablePrompt, setEditablePrompt] = useState('');
  const [generateError, setGenerateError] = useState('');
  const [saveTitle, setSaveTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);

  const [libraryPrompts, setLibraryPrompts] = useState<PromptSummary[]>([]);
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryCategoryFilter, setLibraryCategoryFilter] = useState('');
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState<SavedPromptDetail | null>(null);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [editedLibraryContent, setEditedLibraryContent] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<PromptVersion | null>(null);

  const projectOptions = useMemo(
    () =>
      contextProjects
        .filter((p) => p.status !== 'Archived')
        .map((p) => ({ value: p.id, label: `${p.code} — ${p.title}`, sublabel: `${p.status} · ${p.priority || 'No priority'}` })),
    [contextProjects]
  );

  const taskOptions = useMemo(
    () =>
      contextTasks
        .filter((t) => t.projectId === selectedProject)
        .map((t) => ({ value: t.id, label: `${t.taskNumber} — ${t.title}`, sublabel: `${t.status} · ${t.priority}` })),
    [contextTasks, selectedProject]
  );

  const categoryOptions = useMemo(
    () => CATEGORIES.map((c) => ({ value: c.code, label: c.name, sublabel: c.description })),
    []
  );

  const styleOptions = useMemo(
    () => STYLES.map((s) => ({ value: s.value, label: s.label })),
    []
  );

  const activeCategory = CATEGORIES.find((c) => c.code === selectedCategory);

  const handleGenerate = useCallback(async () => {
    if (!selectedProject || !selectedCategory) return;
    setGenerating(true);
    setGenerateError('');
    setGeneratedPrompt('');
    setEditablePrompt('');

    try {
      addAIQueryLog(
        `Generate ${selectedCategory} prompt for project ${selectedProject}${selectedTask ? `, task ${selectedTask}` : ''}`,
        `Project: ${selectedProject}`,
        'Prompt generated successfully'
      );

      const project = contextProjects.find((p) => p.id === selectedProject);
      const task = contextTasks.find((t) => t.id === selectedTask);

      const data = await apiFetch('/generate', {
        method: 'POST',
        body: JSON.stringify({
          projectId: selectedProject,
          projectName: project?.title || '',
          projectDescription: project?.description || '',
          taskId: selectedTask || undefined,
          taskTitle: task?.title || '',
          taskDescription: task?.description || '',
          category: selectedCategory,
          additionalInstructions: additionalContext || undefined,
          style: selectedStyle,
        }),
      });

      setGeneratedPrompt(data.promptText);
      setEditablePrompt(data.promptText);
      setJustSaved(false);
    } catch (err: any) {
      setGenerateError(err.message || 'Failed to generate prompt.');
    } finally {
      setGenerating(false);
    }
  }, [selectedProject, selectedTask, selectedCategory, selectedStyle, additionalContext, addAIQueryLog, contextProjects, contextTasks]);

  const handleSave = useCallback(async () => {
    if (!saveTitle.trim() || !editablePrompt) return;
    setSaving(true);
    try {
      const project = contextProjects.find((p) => p.id === selectedProject);
      const defaultTitle = project
        ? `${activeCategory?.name || selectedCategory} — ${project.title}`
        : `${activeCategory?.name || selectedCategory} Prompt`;

      await apiFetch('/prompts', {
        method: 'POST',
        body: JSON.stringify({
          projectId: selectedProject || null,
          taskId: selectedTask || null,
          category: selectedCategory,
          title: saveTitle.trim() || defaultTitle,
          style: selectedStyle,
          additionalInstructions: additionalContext || null,
          content: editablePrompt,
          isAiGenerated: editablePrompt === generatedPrompt,
        }),
      });
      setShowSaveModal(false);
      setSaveTitle('');
      setJustSaved(true);
      if (activeTab === 'library') loadLibrary();
    } catch (err: any) {
      setGenerateError(err.message || 'Failed to save prompt.');
    } finally {
      setSaving(false);
    }
  }, [saveTitle, editablePrompt, selectedProject, selectedCategory, selectedStyle, additionalContext, generatedPrompt, activeTab, contextProjects, activeCategory, selectedTask, libraryPrompts]);

  const loadLibrary = useCallback(async (search?: string, category?: string) => {
    setLoadingLibrary(true);
    setLibraryError('');
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (category) params.set('category', category);
      const data = await apiFetch(`/prompts?${params.toString()}`);
      setLibraryPrompts(data || []);
    } catch (err: any) {
      setLibraryError(err.message);
    } finally {
      setLoadingLibrary(false);
    }
  }, []);

  useEffect(() => {
    if (justSaved) setJustSaved(false);
  }, [editablePrompt]);

  useEffect(() => {
    if (activeTab === 'library') loadLibrary(librarySearch, libraryCategoryFilter);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'library') return;
    const timer = setTimeout(() => loadLibrary(librarySearch, libraryCategoryFilter), 300);
    return () => clearTimeout(timer);
  }, [librarySearch, libraryCategoryFilter, activeTab, loadLibrary]);

  const handleOpenPrompt = useCallback(async (id: string) => {
    try {
      setShowVersions(false);
      const data = await apiFetch(`/prompts/${id}`);
      setSelectedPrompt(data);
      setEditedLibraryContent(data.versions[data.versions.length - 1]?.content || '');
      const vers = await apiFetch(`/prompts/${id}/versions`);
      setVersions(vers || []);
    } catch (err: any) {
      setLibraryError(err.message);
    }
  }, []);

  const handleLoadVersions = useCallback(async (id: string) => {
    try {
      const data = await apiFetch(`/prompts/${id}/versions`);
      setVersions(data || []);
      setShowVersions(true);
    } catch (err: any) {
      setLibraryError(err.message);
    }
  }, []);

  const handleRestoreVersion = useCallback(async (promptId: string, versionId: string) => {
    try {
      await apiFetch(`/prompts/${promptId}/restore/${versionId}`, { method: 'POST' });
      const data = await apiFetch(`/prompts/${promptId}`);
      const vers = await apiFetch(`/prompts/${promptId}/versions`);
      setSelectedPrompt(data);
      setEditedLibraryContent(data.versions[data.versions.length - 1]?.content || '');
      setVersions(vers || []);
      loadLibrary(librarySearch, libraryCategoryFilter);
    } catch (err: any) {
      setLibraryError(err.message);
    }
  }, [librarySearch, libraryCategoryFilter, loadLibrary]);

  const handleSaveLibraryEdit = useCallback(async () => {
    if (!selectedPrompt || !editedLibraryContent.trim()) return;
    setSavingEdit(true);
    try {
      const data = await apiFetch(`/prompts/${selectedPrompt.id}`, {
        method: 'PUT',
        body: JSON.stringify({ content: editedLibraryContent }),
      });
      setSelectedPrompt(data);
      setEditedLibraryContent(data.versions[data.versions.length - 1]?.content || '');
      const vers = await apiFetch(`/prompts/${selectedPrompt.id}/versions`);
      setVersions(vers || []);
      loadLibrary(librarySearch, libraryCategoryFilter);
    } catch (err: any) {
      setLibraryError(err.message);
    } finally {
      setSavingEdit(false);
    }
  }, [selectedPrompt, editedLibraryContent, librarySearch, libraryCategoryFilter, loadLibrary]);

  const handleArchive = useCallback(async (id: string) => {
    try {
      await apiFetch(`/prompts/${id}`, { method: 'DELETE' });
      setSelectedPrompt(null);
      loadLibrary(librarySearch, libraryCategoryFilter);
    } catch (err: any) {
      setLibraryError(err.message);
    }
  }, [librarySearch, libraryCategoryFilter, loadLibrary]);

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setJustCopied(true);
    setTimeout(() => setJustCopied(false), 2000);
  };

  return (
    <div data-ai-assistant className="max-w-6xl mx-auto space-y-4 sm:space-y-6 px-1 sm:px-0">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
          <Sparkles size={22} />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">AI Assistant</h2>
          <p className="text-xs text-slate-400">Generate, edit, and manage AI-powered prompts using project and task context</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-white/10 pb-1">
        <button
          onClick={() => { setActiveTab('generate'); setSelectedPrompt(null); }}
          className={`px-4 py-2 rounded-t-lg text-sm font-semibold transition-all ${
            activeTab === 'generate'
              ? 'bg-purple-500/20 text-purple-300 border-b-2 border-purple-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles size={14} className="inline mr-1.5" />Generate
        </button>
        <button
          onClick={() => { setActiveTab('library'); setSelectedPrompt(null); }}
          className={`px-4 py-2 rounded-t-lg text-sm font-semibold transition-all ${
            activeTab === 'library'
              ? 'bg-purple-500/20 text-purple-300 border-b-2 border-purple-400'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileText size={14} className="inline mr-1.5" />Prompt Library
        </button>
      </div>

      {activeTab === 'generate' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="glass-panel p-5 border border-purple-500/20 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FolderKanban size={16} className="text-purple-400" /> Prompt Configuration
              </h3>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-semibold">Project *</label>
                <SearchableSelect
                  options={projectOptions}
                  value={selectedProject}
                  onChange={(v) => { setSelectedProject(v); setSelectedTask(''); }}
                  placeholder="Search or select a project..."
                  emptyMessage={contextProjects.length === 0 ? 'No projects available' : 'No matching projects'}
                />
              </div>

              {(!activeCategory || activeCategory.requiresTask || selectedTask) && (
                <div>
                  <label className="block text-xs text-slate-400 mb-1.5 font-semibold">
                    Task {activeCategory?.requiresTask ? '*' : '(optional)'}
                  </label>
                  <SearchableSelect
                    options={taskOptions}
                    value={selectedTask}
                    onChange={setSelectedTask}
                    placeholder={selectedProject ? 'Search or select a task...' : 'Select a project first'}
                    disabled={!selectedProject}
                    emptyMessage={selectedProject ? 'No tasks in this project' : ''}
                  />
                </div>
              )}

              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-semibold">Prompt Category *</label>
                <SearchableSelect
                  options={categoryOptions}
                  value={selectedCategory}
                  onChange={setSelectedCategory}
                  placeholder="Search or select a category..."
                  emptyMessage="No matching categories"
                />
              </div>

              {activeCategory && (
                <div className="p-3 rounded-lg bg-white/[0.03] border border-white/5">
                  <p className="text-xs text-slate-400 leading-relaxed">{activeCategory.description}</p>
                </div>
              )}

              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-semibold">Style</label>
                <SearchableSelect
                  options={styleOptions}
                  value={selectedStyle}
                  onChange={setSelectedStyle}
                  placeholder="Select style..."
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-semibold">Additional Context / Instructions</label>
                <textarea
                  value={additionalContext}
                  onChange={(e) => setAdditionalContext(e.target.value)}
                  placeholder="E.g., Focus on security and edge cases..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-slate-200 placeholder-slate-500 focus:border-purple-500/50 focus:outline-none resize-none"
                />
              </div>

              <button
                onClick={handleGenerate}
                disabled={generating || !selectedProject || !selectedCategory}
                className="w-full py-2.5 rounded-xl glass-button-neon font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <><RefreshCw size={16} className="animate-spin" /> Generating...</>
                ) : (
                  <><Sparkles size={16} /> Generate Prompt</>
                )}
              </button>

              {generateError && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs leading-relaxed">
                  {generateError}
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="glass-panel p-5 border border-purple-500/20 h-full flex flex-col">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2 shrink-0">
                  <FileText size={16} className="text-purple-400" /> Generated Prompt
                </h3>
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  {generatedPrompt && (
                    <>
                      <button
                        onClick={handleGenerate}
                        disabled={generating}
                        className="px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold bg-slate-800/50 border border-white/10 text-slate-300 hover:text-white hover:border-purple-500/40 transition-all flex items-center gap-1 sm:gap-1.5 disabled:opacity-50"
                      >
                        <RotateCcw size={11} className="sm:size-[12]" /> Regenerate
                      </button>
                      <button
                        onClick={() => handleCopy(editablePrompt)}
                        className={`px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold flex items-center gap-1 sm:gap-1.5 transition-all ${
                          justCopied
                            ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                            : 'bg-slate-800/50 border border-white/10 text-slate-300 hover:text-white hover:border-cyan-500/40'
                        }`}
                      >
                        {justCopied ? <><Check size={11} className="sm:size-[12]" /> Copied</> : <><Copy size={11} className="sm:size-[12]" /> Copy</>}
                      </button>
                      <button
                        onClick={() => { setSaveTitle(''); setShowSaveModal(true); }}
                        disabled={justSaved}
                        className={`px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold flex items-center gap-1 sm:gap-1.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                          justSaved
                            ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                            : 'glass-button-neon'
                        }`}
                      >
                        {justSaved ? <><Check size={11} className="sm:size-[12]" /> Saved</> : <><Save size={11} className="sm:size-[12]" /> Save</>}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {!generatedPrompt && !generating && (
                <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
                  <div className="text-center space-y-2">
                    <Sparkles size={32} className="mx-auto text-purple-500/40" />
                    <p>Select a project and category, then generate a prompt</p>
                  </div>
                </div>
              )}

              {generating && (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center space-y-3">
                    <RefreshCw size={32} className="mx-auto text-purple-400 animate-spin" />
                    <p className="text-slate-400 text-sm">Generating prompt using AI...</p>
                    <p className="text-xs text-slate-500">Gathering project and task context</p>
                  </div>
                </div>
              )}

              {generatedPrompt && (
                <textarea
                  value={editablePrompt}
                  onChange={(e) => setEditablePrompt(e.target.value)}
                  className="flex-1 w-full p-4 rounded-xl bg-black/40 border border-white/10 text-sm text-slate-200 font-mono leading-relaxed resize-none focus:border-purple-500/50 focus:outline-none min-h-[200px]"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'library' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="glass-panel p-5 border border-cyan-500/20 space-y-4 relative z-10">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Search size={16} className="text-cyan-400" /> Search & Filter
              </h3>

              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  placeholder="Search prompts by title or content..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-slate-200 placeholder-slate-500 focus:border-cyan-500/50 focus:outline-none"
                />
                {librarySearch && (
                  <button onClick={() => setLibrarySearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                    <X size={14} />
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-semibold">Category</label>
                <SearchableSelect
                  options={[{ value: '', label: 'All Categories' }, ...categoryOptions]}
                  value={libraryCategoryFilter}
                  onChange={setLibraryCategoryFilter}
                  placeholder="Filter by category..."
                />
              </div>

              <button
                onClick={() => loadLibrary(librarySearch, libraryCategoryFilter)}
                className="w-full py-2 rounded-xl glass-button-neon font-bold text-xs flex items-center justify-center gap-2"
              >
                <RefreshCw size={14} /> Refresh
              </button>
            </div>

            <div className="glass-panel p-4 border border-white/10">
              <h4 className="text-xs font-bold text-slate-400 mb-3 flex items-center gap-1.5">
                <FileText size={12} /> Saved Prompts ({libraryPrompts.length})
              </h4>

              {loadingLibrary && (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw size={20} className="text-cyan-400 animate-spin" />
                </div>
              )}

              {libraryError && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs mb-3">
                  {libraryError}
                </div>
              )}

              {!loadingLibrary && libraryPrompts.length === 0 && (
                <div className="text-center py-8 text-slate-500 text-xs space-y-1">
                  <FileText size={24} className="mx-auto opacity-40 mb-2" />
                  <p>No saved prompts yet</p>
                  <p>Generate and save a prompt to see it here</p>
                </div>
              )}

              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {libraryPrompts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleOpenPrompt(p.id)}
                    className={`w-full text-left p-3 rounded-xl border transition-all ${
                      selectedPrompt?.id === p.id
                        ? 'bg-cyan-500/15 border-cyan-500/40'
                        : 'bg-white/[0.03] border-white/5 hover:bg-cyan-500/10 hover:border-cyan-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-200 truncate">{p.title}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono shrink-0 ${
                        p.category === 'ProjectOverview' ? 'bg-teal-500/20 text-teal-300' :
                        p.category === 'ProjectBreakdown' ? 'bg-blue-500/20 text-blue-300' :
                        p.category === 'CodeReview' ? 'bg-fuchsia-500/20 text-fuchsia-300' :
                        p.category === 'TestCases' ? 'bg-emerald-500/20 text-emerald-300' :
                        p.category === 'Documentation' ? 'bg-amber-500/20 text-amber-300' :
                        'bg-purple-500/20 text-purple-300'
                      }`}>
                        {CATEGORIES.find((c) => c.code === p.category)?.name || p.category}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1 line-clamp-1">{p.latestContent}</p>
                    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-500">
                      <span>{p.versionCount} version{p.versionCount !== 1 ? 's' : ''}</span>
                      {p.isArchived && <span className="text-rose-400">Archived</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-3">
            {selectedPrompt ? (
              <div className="glass-panel p-5 border border-cyan-500/20">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-white truncate">{selectedPrompt.title}</h3>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono">
                        {CATEGORIES.find((c) => c.code === selectedPrompt.category)?.name || selectedPrompt.category}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {selectedPrompt.versions.length} version{selectedPrompt.versions.length !== 1 ? 's' : ''}
                      </span>
                      {selectedPrompt.isArchived && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300">Archived</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">
                    <button
                      onClick={() => handleCopy(selectedPrompt.versions[selectedPrompt.versions.length - 1]?.content || '')}
                      className={`px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold flex items-center gap-1 sm:gap-1.5 transition-all ${
                        justCopied
                          ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                          : 'bg-slate-800/50 border border-white/10 text-slate-300 hover:text-white hover:border-cyan-500/40'
                      }`}
                    >
                      {justCopied ? <><Check size={11} className="sm:size-[12]" /> Copied</> : <><Copy size={11} className="sm:size-[12]" /> Copy</>}
                    </button>
                    <button
                      onClick={() => handleLoadVersions(selectedPrompt.id)}
                      className="px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold bg-slate-800/50 border border-white/10 text-slate-300 hover:text-white hover:border-purple-500/40 transition-all flex items-center gap-1 sm:gap-1.5"
                    >
                      <History size={11} className="sm:size-[12]" /> History
                    </button>
                    {!selectedPrompt.isArchived && (
                      <button
                        onClick={() => handleArchive(selectedPrompt.id)}
                        className="px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 transition-all flex items-center gap-1 sm:gap-1.5"
                      >
                        <Archive size={11} className="sm:size-[12]" /> Archive
                      </button>
                    )}
                  </div>
                </div>

                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] text-slate-500 font-mono">
                        Latest Version ({selectedPrompt.versions.length})
                      </span>
                      <div className="flex items-center gap-2">
                        {selectedPrompt.versions[selectedPrompt.versions.length - 1]?.isAiGenerated && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono">AI</span>
                        )}
                        {editedLibraryContent !== (selectedPrompt.versions[selectedPrompt.versions.length - 1]?.content || '') && (
                          <button
                            onClick={handleSaveLibraryEdit}
                            disabled={savingEdit}
                            className="px-2.5 py-1 rounded-lg text-[10px] font-semibold glass-button-neon flex items-center gap-1 disabled:opacity-50"
                          >
                            {savingEdit ? 'Saving...' : <><Save size={11} /> Save</>}
                          </button>
                        )}
                      </div>
                    </div>
                    <textarea
                      value={editedLibraryContent}
                      onChange={(e) => setEditedLibraryContent(e.target.value)}
                      className="w-full p-4 rounded-xl bg-black/40 border border-white/10 text-sm text-slate-200 font-mono leading-relaxed resize-none min-h-[180px] focus:border-purple-500/50 focus:outline-none"
                    />
                  </div>

                {showVersions && versions.length > 0 && (
                  <div className="mt-4 border-t border-white/10 pt-4">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <History size={16} className="text-purple-400" /> Version History
                      </h4>
                      <button onClick={() => setShowVersions(false)} className="p-1 text-slate-400 hover:text-white shrink-0">
                        <X size={16} />
                      </button>
                    </div>
                    <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                      {[...versions].reverse().map((v) => (
                        <div
                          key={v.versionId}
                          onClick={() => setPreviewVersion(v)}
                          className="p-3 rounded-xl bg-white/[0.03] border border-white/5 hover:border-purple-500/30 transition-all cursor-pointer"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white">Version {v.versionNumber}</span>
                              {v.isAiGenerated && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono">AI</span>
                              )}
                              {v.versionNumber === selectedPrompt?.versions.length && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono">Current</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-500">{v.createdByName}</span>
                              {v.createdAtUtc && (
                                <span className="text-[10px] text-slate-500">
                                  {new Date(v.createdAtUtc).toLocaleDateString()}
                                </span>
                              )}
                              {selectedPrompt && v.versionNumber !== selectedPrompt.versions.length && (
                                <button
                                  onClick={() => {
                                    handleRestoreVersion(selectedPrompt.id, v.versionId);
                                    setShowVersions(false);
                                  }}
                                  className="px-2 py-1 rounded text-[10px] font-semibold bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 transition-all"
                                >
                                  Restore
                                </button>
                              )}
                            </div>
                          </div>
                          <pre className="text-[11px] text-slate-400 font-mono whitespace-pre-wrap line-clamp-4">
                            {v.content}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="glass-panel p-5 border border-white/10 flex items-center justify-center min-h-[400px]">
                <div className="text-center text-slate-500 text-sm space-y-2">
                  <FileText size={32} className="mx-auto opacity-40" />
                  <p>Select a prompt from the library to view its content</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {previewVersion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md" onClick={() => setPreviewVersion(null)}>
          <div className="w-full max-w-3xl glass-panel-glow border border-purple-500/40 p-6 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 shrink-0">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <History size={16} className="text-purple-400" /> Version {previewVersion.versionNumber}
              </h3>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <span className="text-[10px] text-slate-500">{previewVersion.createdByName}</span>
                {previewVersion.createdAtUtc && (
                  <span className="text-[10px] text-slate-500">{new Date(previewVersion.createdAtUtc).toLocaleDateString()}</span>
                )}
                {previewVersion.isAiGenerated && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono">AI</span>
                )}
                {selectedPrompt && previewVersion.versionNumber !== selectedPrompt.versions.length && (
                  <button
                    onClick={() => {
                      handleRestoreVersion(selectedPrompt.id, previewVersion.versionId);
                      setPreviewVersion(null);
                      setShowVersions(false);
                    }}
                    className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 transition-all"
                  >
                    Restore This Version
                  </button>
                )}
                <button onClick={() => setPreviewVersion(null)} className="p-1 text-slate-400 hover:text-white">
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1">
              <pre className="text-sm text-slate-200 font-mono leading-relaxed whitespace-pre-wrap">
                {previewVersion.content}
              </pre>
            </div>
          </div>
        </div>
      )}

      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md" onClick={() => setShowSaveModal(false)}>
          <div className="w-full max-w-md glass-panel-glow border border-purple-500/40 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Save size={16} className="text-purple-400" /> Save Prompt
              </h3>
              <button onClick={() => setShowSaveModal(false)} className="p-1 text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-semibold">Title *</label>
                <input
                  type="text"
                  value={saveTitle}
                  onChange={(e) => setSaveTitle(e.target.value)}
                  placeholder="Enter a title for this prompt..."
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm text-slate-200 placeholder-slate-500 focus:border-purple-500/50 focus:outline-none"
                />
              </div>
              <div className="text-xs text-slate-500 space-y-0.5">
                <p>Category: <span className="text-slate-300">{CATEGORIES.find((c) => c.code === selectedCategory)?.name || selectedCategory}</span></p>
                <p>Style: <span className="text-slate-300">{selectedStyle}</span></p>
              </div>
              <button
                onClick={handleSave}
                disabled={saving || !saveTitle.trim()}
                className="w-full py-2.5 rounded-xl glass-button-neon font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Save to Library'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
