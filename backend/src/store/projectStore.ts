import { query } from '../db/pool.js';

interface BackendProject {
  id: string;
  code: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  ownerUserId: string;
  memberIds: string[];
  startDate: string;
  endDate: string;
  milestones: {
    id: string;
    title: string;
    dueDate: string;
    completed: boolean;
  }[];
}

interface BackendTask {
  id: string;
  projectId: string;
  taskNumber: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assigneeId: string;
  dueDate: string;
  dependencies: string[];
}

class ProjectStore {
  async getProjectsForUser(
    userId: string,
    role: string
  ): Promise<BackendProject[]> {
    let result;

    if (role === 'Admin' || role === 'Administrator') {
      result = await query(`
        SELECT
          p.projectid,
          p.projectcode,
          p.projectname,
          p.description,
          p.owneruserid,
          ps.statusname AS status,
          pr.priorityname AS priority,
          p.startdate,
          p.enddate
        FROM work.projects p
        JOIN work.projectstatuses ps
          ON ps.projectstatusid = p.projectstatusid
        JOIN work.priorities pr
          ON pr.priorityid = p.priorityid
        ORDER BY p.projectid
      `);
    } else {
      result = await query(
        `
        SELECT DISTINCT
          p.projectid,
          p.projectcode,
          p.projectname,
          p.description,
          p.owneruserid,
          ps.statusname AS status,
          pr.priorityname AS priority,
          p.startdate,
          p.enddate
        FROM work.projects p
        JOIN work.projectstatuses ps
          ON ps.projectstatusid = p.projectstatusid
        JOIN work.priorities pr
          ON pr.priorityid = p.priorityid
        LEFT JOIN work.projectmembers pm
          ON pm.projectid = p.projectid
          AND pm.userid = $1
          AND pm.leftatutc IS NULL
        WHERE p.owneruserid = $1
           OR pm.userid IS NOT NULL
        ORDER BY p.projectid
        `,
        [Number(userId)]
      );
    }

    return Promise.all(
      result.rows.map((row) => this.mapProject(row))
    );
  }

  async getProjectById(
    projectId: string
  ): Promise<BackendProject | undefined> {
    const result = await query(
      `
      SELECT
        p.projectid,
        p.projectcode,
        p.projectname,
        p.description,
        p.owneruserid,
        ps.statusname AS status,
        pr.priorityname AS priority,
        p.startdate,
        p.enddate
      FROM work.projects p
      JOIN work.projectstatuses ps
        ON ps.projectstatusid = p.projectstatusid
      JOIN work.priorities pr
        ON pr.priorityid = p.priorityid
      WHERE p.projectid = $1
      `,
      [Number(projectId)]
    );

    if (result.rows.length === 0) {
      return undefined;
    }

    return this.mapProject(result.rows[0]);
  }

  async isProjectAccessible(
    projectId: string,
    userId: string,
    role: string
  ): Promise<boolean> {
    if (role === 'Admin' || role === 'Administrator') {
      const result = await query(
        `
        SELECT 1
        FROM work.projects
        WHERE projectid = $1
        LIMIT 1
        `,
        [Number(projectId)]
      );

      return result.rows.length > 0;
    }

    const result = await query(
      `
      SELECT 1
      FROM work.projects p
      LEFT JOIN work.projectmembers pm
        ON pm.projectid = p.projectid
        AND pm.userid = $2
        AND pm.leftatutc IS NULL
      WHERE p.projectid = $1
        AND (
          p.owneruserid = $2
          OR pm.userid IS NOT NULL
        )
      LIMIT 1
      `,
      [Number(projectId), Number(userId)]
    );

    return result.rows.length > 0;
  }

  async getTasksForProject(
    projectId: string,
    userId: string,
    role: string
  ): Promise<BackendTask[]> {
    const accessible = await this.isProjectAccessible(
      projectId,
      userId,
      role
    );

    if (!accessible) {
      return [];
    }

    const result = await query(
      `
      SELECT
        t.taskid,
        t.projectid,
        t.tasknumber,
        t.title,
        t.description,
        ts.statusname AS status,
        pr.priorityname AS priority,
        t.duedate
      FROM work.tasks t
      JOIN work.taskstatuses ts
        ON ts.taskstatusid = t.taskstatusid
      JOIN work.priorities pr
        ON pr.priorityid = t.priorityid
      WHERE t.projectid = $1
        AND t.archivedatutc IS NULL
      ORDER BY t.sortposition, t.taskid
      `,
      [Number(projectId)]
    );

    return Promise.all(
      result.rows.map((row) => this.mapTask(row))
    );
  }

  async getTaskById(
    taskId: string
  ): Promise<BackendTask | undefined> {
    const result = await query(
      `
      SELECT
        t.taskid,
        t.projectid,
        t.tasknumber,
        t.title,
        t.description,
        ts.statusname AS status,
        pr.priorityname AS priority,
        t.duedate
      FROM work.tasks t
      JOIN work.taskstatuses ts
        ON ts.taskstatusid = t.taskstatusid
      JOIN work.priorities pr
        ON pr.priorityid = t.priorityid
      WHERE t.taskid = $1
      `,
      [Number(taskId)]
    );

    if (result.rows.length === 0) {
      return undefined;
    }

    return this.mapTask(result.rows[0]);
  }

  async isTaskAccessible(
    taskId: string,
    userId: string,
    role: string
  ): Promise<boolean> {
    const task = await this.getTaskById(taskId);

    if (!task) {
      return false;
    }

    return this.isProjectAccessible(
      task.projectId,
      userId,
      role
    );
  }

  async getAllProjects(): Promise<BackendProject[]> {
    const result = await query(`
      SELECT
        p.projectid,
        p.projectcode,
        p.projectname,
        p.description,
        p.owneruserid,
        ps.statusname AS status,
        pr.priorityname AS priority,
        p.startdate,
        p.enddate
      FROM work.projects p
      JOIN work.projectstatuses ps
        ON ps.projectstatusid = p.projectstatusid
      JOIN work.priorities pr
        ON pr.priorityid = p.priorityid
      ORDER BY p.projectid
    `);

    return Promise.all(
      result.rows.map((row) => this.mapProject(row))
    );
  }

  async getAllTasks(): Promise<BackendTask[]> {
    const result = await query(`
      SELECT
        t.taskid,
        t.projectid,
        t.tasknumber,
        t.title,
        t.description,
        ts.statusname AS status,
        pr.priorityname AS priority,
        t.duedate
      FROM work.tasks t
      JOIN work.taskstatuses ts
        ON ts.taskstatusid = t.taskstatusid
      JOIN work.priorities pr
        ON pr.priorityid = t.priorityid
      WHERE t.archivedatutc IS NULL
      ORDER BY t.projectid, t.sortposition, t.taskid
    `);

    return Promise.all(
      result.rows.map((row) => this.mapTask(row))
    );
  }

  private async mapProject(row: any): Promise<BackendProject> {
    const membersResult = await query(
      `
      SELECT userid
      FROM work.projectmembers
      WHERE projectid = $1
        AND leftatutc IS NULL
      ORDER BY projectmemberid
      `,
      [row.projectid]
    );

    const milestonesResult = await query(
      `
      SELECT
        milestoneid,
        milestonename,
        duedate,
        completedatutc
      FROM work.projectmilestones
      WHERE projectid = $1
      ORDER BY duedate, milestoneid
      `,
      [row.projectid]
    );

    return {
      id: String(row.projectid),
      code: row.projectcode,
      title: row.projectname,
      description: row.description,
      status: row.status,
      priority: row.priority,
      ownerUserId: String(row.owneruserid),
      memberIds: membersResult.rows.map(
        (member) => String(member.userid)
      ),
      startDate: row.startdate,
      endDate: row.enddate,
      milestones: milestonesResult.rows.map((milestone) => ({
        id: String(milestone.milestoneid),
        title: milestone.milestonename,
        dueDate: milestone.duedate,
        completed: Boolean(milestone.completedatutc),
      })),
    };
  }

  private async mapTask(row: any): Promise<BackendTask> {
    const assigneeResult = await query(
      `
      SELECT userid
      FROM work.taskassignees
      WHERE taskid = $1
        AND unassignedatutc IS NULL
      ORDER BY taskassigneeid
      LIMIT 1
      `,
      [row.taskid]
    );

    const dependencyResult = await query(
      `
      SELECT dependsontaskid
      FROM work.taskdependencies
      WHERE taskid = $1
      ORDER BY dependsontaskid
      `,
      [row.taskid]
    );

    return {
      id: String(row.taskid),
      projectId: String(row.projectid),
      taskNumber: String(row.tasknumber),
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      assigneeId: assigneeResult.rows.length
        ? String(assigneeResult.rows[0].userid)
        : '',
      dueDate: row.duedate,
      dependencies: dependencyResult.rows.map(
        (dependency) => String(dependency.dependsontaskid)
      ),
    };
  }
}

export const projectStore = new ProjectStore();
