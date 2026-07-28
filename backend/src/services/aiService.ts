const GROQ_API_BASE = 'https://api.groq.com/openai/v1';

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

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
  'Generate a self-contained project lifeline and comprehensive project analysis prompt about the entire project. The prompt must act as a complete project briefing that gives another AI full situational awareness while also instructing it to analyze and interpret the provided project data rather than merely repeating it. The AI should explain what the current project state means, how tasks and milestones affect progress, which dependencies and blockers create risks, whether deadlines and priorities are at risk, and what actions should be prioritized next. It must include:\n\n' +
  '1. Project Overview: Explain the project name, description, objectives, current status, priority, and overall health based on task completion, progress, deadlines, dependencies, and blockers.\n' +
  '2. Every Task in the Project: For each task, include and analyze the task number, title, full description, current status, priority, assignee, due date, dependencies, and any discussion/progress updates available in the project data. Explain the significance of each task\'s current status and identify whether it is completed, progressing normally, at risk, pending, or blocked.\n' +
  '3. Progress Analysis: Analyze what work is completed, in progress, pending, or blocked. Explain the current progress of the project and identify important gaps, delays, or areas requiring attention.\n' +
  '4. Milestone Analysis: List all milestones, their due dates, and completion status. Analyze milestone progress and explain how upcoming or delayed milestones may affect the overall project timeline.\n' +
  '5. Dependencies & Blockers: Identify all task dependencies and blockers. Explain how each dependency or blocker affects other tasks, milestones, deadlines, or the overall project. Distinguish between direct critical-path blockers and broader project-level risks.\n' +
  '6. Team Analysis: List the key people involved and explain any relevant ownership, workload, or responsibility considerations based on the provided task assignments.\n' +
  '7. Risk Assessment: Identify and explain potential risks based on task priorities, deadlines, blocked work, dependencies, missing resources, and milestone timelines. Explain the potential impact of each risk.\n' +
  '8. Overall Project Health: Provide a reasoned assessment of the project trajectory. Do not simply repeat the provided status. Explain why the project appears healthy, at risk, or blocked based on the available evidence.\n' +
  '9. Recommended Next Steps: Provide prioritized, actionable recommendations based on the analysis. Explain what should be addressed first, which blockers should be escalated, and what actions can reduce project risk or improve progress.\n\n' +
  'The generated prompt must instruct the AI to deeply analyze, explain, interpret, and reason about the provided project information. It must NOT merely restate or summarize the data. The AI should connect tasks, dependencies, blockers, milestones, deadlines, and priorities to explain their impact on the project as a whole. It should identify critical paths and distinguish between direct blockers and general risks where possible. Recommendations must be based only on the provided project context.\n\n' +
  'Structure the prompt with clear markdown sections (## headings) so another AI can immediately understand the full project landscape and perform a meaningful analysis. Use ONLY the data provided in the context below — do NOT invent tasks, statuses, updates, progress, team information, or other facts that were not provided.',  TaskDescription:
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
