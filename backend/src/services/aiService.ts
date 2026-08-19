const GROQ_API_BASE = 'https://api.groq.com/openai/v1';

const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

function getApiKey(): string {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY environment variable not configured');
  }
  return apiKey;
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

interface PromptContext {
  projectName: string;
  projectDescription: string;
  projectStatus: string;
  projectPriority: string;
  mainTask?: string;
  taskTitle?: string;
  taskDescription?: string;
  taskStatus?: string;
  taskPriority?: string;
  taskDeadline?: string;
  taskAssignees?: string;
  milestones?: string;
  dependencies?: string;
  projectTasks?: string;
  projectMembers?: string;
}

interface GeneratePromptParams {
  category: string;
  context: PromptContext;
  additionalInstructions?: string;
  style?: string;
}

const STYLE_PROMPTS: Record<string, string> = {
  Default: 'Write in a clear, professional tone.',
  Short: 'Keep the prompt concise — under 150 words.',
  Long: 'Write a very detailed prompt with comprehensive instructions.',
  Technical: 'Use technical language suitable for senior engineers.',
  Beginner: 'Explain concepts clearly as if addressing a junior developer.',
  Checklist: 'Organize the prompt as a bullet-point checklist of items to verify or complete.',
  StepByStep: 'Structure the prompt as sequential numbered steps.',
};

const CATEGORY_INSTRUCTIONS: Record<string, string> = {
  ProjectBreakdown:
    'Generate a prompt that asks an AI to provide a detailed breakdown of the given project. Include analysis of scope, deliverables, risks, and recommended phases.',
  ProjectOverview:
  'Generate a self-contained project lifeline and comprehensive project analysis prompt about the entire project. The prompt must embed ALL project data inline so another AI can analyze it. This is NOT a summary — you must list every single task with its complete details.\n\n' +
  'Structure the prompt with these exact sections (## headings):\n\n' +
  '## Project Overview\n' +
  'Embed the project name, description, status, priority, and a brief statement of overall health based on the provided data.\n\n' +
  '## Full Task Breakdown\n' +
  'List **every task** in the project one by one. For each task you MUST include:\n' +
  '- Task number and title\n' +
  '- Full description\n' +
  '- Current status\n' +
  '- Priority and due date\n' +
  '- Assignee\n' +
  '- Dependencies\n' +
  '- **Full status timeline** — every single status change in order, with the date, who changed it, and their exact note/reason (e.g. "[Todo → In Progress] on Jul 20 by Salman: \\"Started implementation\\""). This is critical — do not skip any transition.\n' +
  '- Any discussions or progress updates\n' +
  '- Analysis of what this task means for the project\n\n' +
  '## Progress Summary\n' +
  'Analyze what is completed, in progress, pending, or blocked. Identify gaps and risks.\n\n' +
  '## Milestones\n' +
  'List each milestone with due date and status. Explain how delays affect the timeline.\n\n' +
  '## Dependencies & Blockers\n' +
  'Map out all dependency chains. Identify critical-path blockers and distinguish them from general risks.\n\n' +
  '## Team Overview\n' +
  'List members and their role based on task assignments.\n\n' +
  '## Risk Assessment\n' +
  'Identify risks from blocked tasks, missed deadlines, high-priority overdue items, and dependency chains.\n\n' +
  '## Recommended Next Steps\n' +
  'Provide actionable, prioritized recommendations based solely on the provided data.\n\n' +
  'CRITICAL RULES:\n' +
  '- You MUST list EVERY task from the "All Project Tasks" context below. Do not skip any task.\n' +
  '- For each task you MUST include its full status timeline with every transition, date, person, and note.\n' +
  '- Embed the actual task data directly into the prompt — do not just tell the AI to "look at the tasks".\n' +
  '- Use ONLY the data provided — never invent tasks, statuses, dates, or people.\n' +
  '- Do not add any preamble or explanation outside the prompt itself.',  TaskDescription:
    'Generate a prompt that asks an AI to write a detailed, clear task description including acceptance criteria, technical notes, and edge cases.',
  AcceptanceCriteria:
    'Generate a prompt that asks an AI to define comprehensive acceptance criteria for the given task, covering functional, non-functional, and edge-case scenarios.',
  CodeReview:
    'Generate a prompt that asks an AI to act as a senior engineer and conduct a thorough code review. Specify areas to analyze: architecture, security, performance, error handling, testing, and best practices.',
  TestCases:
    'Generate a prompt that asks an AI to design comprehensive test cases covering unit, integration, and edge-case scenarios for the described functionality.',
  Documentation:
    'Generate a prompt that asks an AI to write clear, professional documentation for the project, including overview, setup instructions, architecture decisions, and API references.',
};

interface GroqChoice {
  message: { content: string };
}

interface GroqResponse {
  choices: GroqChoice[];
}

export async function generatePrompt(params: GeneratePromptParams): Promise<string> {
  const apiKey = getApiKey();
  const { category, context, additionalInstructions, style } = params;

  const styleInstruction = STYLE_PROMPTS[style || 'Default'] || STYLE_PROMPTS.Default;
  const categoryInstruction = CATEGORY_INSTRUCTIONS[category] || CATEGORY_INSTRUCTIONS.TaskDescription;

  let contextText = `PROJECT CONTEXT:\nName: ${context.projectName}\nDescription: ${context.projectDescription}\nStatus: ${context.projectStatus}\nPriority: ${context.projectPriority}`;

  if (context.mainTask) {
    contextText += `\nMain Task / Goal: ${context.mainTask}`;
  }

  if (context.taskTitle) {
    contextText += `\n\nTASK CONTEXT:\nTitle: ${context.taskTitle}\nDescription: ${context.taskDescription}\nStatus: ${context.taskStatus}\nPriority: ${context.taskPriority}\nDeadline: ${context.taskDeadline}`;
  }

  if (context.taskAssignees) {
    contextText += `\nAssignees: ${context.taskAssignees}`;
  }

  if (context.milestones) {
    contextText += `\n\nMilestones:\n${context.milestones}`;
  }

  if (context.dependencies) {
    contextText += `\n\nDependencies:\n${context.dependencies}`;
  }

  if (context.projectTasks) {
    contextText += `\n\nAll Project Tasks:\n${context.projectTasks}`;
  }

  if (context.projectMembers) {
    contextText += `\n\nKey Team Members:\n${context.projectMembers}`;
  }

  const systemPrompt = `You are an expert prompt engineering assistant. Your role is to generate a single, high-quality prompt that the user can copy and use with another AI tool (ChatGPT, Claude, Cursor, etc.). Use only the project, task, milestone, dependency, team, and discussion data provided in the context. Never invent facts, statuses, assignees, deadlines, dependencies, progress updates, APIs, or implementation details. When making an inference or recommendation, clearly identify it as an analysis or recommendation rather than presenting it as a confirmed fact.

${categoryInstruction}

${styleInstruction}

IMPORTANT RULES:
- Generate ONLY the prompt text. Do NOT include any explanation, preamble, or meta-commentary.
- The prompt must be self-contained, professional, and ready to copy-paste into another AI tool.
- Include the following sections where appropriate: Role, Context, Task, Constraints, Expected Output Format, Edge Cases.
- Do NOT include phrases like "Here is your prompt:" or "I have generated a prompt for you."
- Output only the prompt content, nothing else.`;

  const userMessage = `Generate a high-quality prompt for the following context:\n\n${contextText}\n\n${additionalInstructions ? `Additional instructions: ${additionalInstructions}` : ''}`;

  try {
    const response = await fetch(`${GROQ_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      const status = response.status;
      const msg = `Groq API error (${status}): ${errorBody.slice(0, 500)}`;
      console.error('[aiService]', msg);

      if (status === 429) {
        throw new Error('AI API rate limit exceeded. Please try again later.');
      }
      if (status === 401 || status === 403) {
        throw new Error('Invalid API key. Please check your GROQ_API_KEY.');
      }

      throw new Error(msg);
    }

    const data: GroqResponse = await response.json();
    const generatedText = data.choices?.[0]?.message?.content;

    if (!generatedText) {
      throw new Error('AI returned empty response');
    }

    return generatedText.trim();
  } catch (error: any) {
    const errMsg = error?.message || '';
    if (/safety/i.test(errMsg)) {
      throw new Error('Prompt generation blocked by AI safety filters. Try rephrasing your request.');
    }
    if (/(?:rate.limit|rate_limit)/i.test(errMsg)) {
      throw new Error('AI API rate limit exceeded. Please try again later.');
    }
    if (/timeout|ECONNABORTED|request-timeout/i.test(errMsg)) {
      throw new Error('AI API request timed out. Please try again.');
    }
    if (/API key|invalid.*(?:401|403)/i.test(errMsg)) {
      throw error;
    }
    throw new Error(`AI generation failed: ${errMsg || 'Unknown error'}`);
  }
}
