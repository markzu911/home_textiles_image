import { NextResponse } from "next/server";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  // In Next.js App Router 15+, params is a Promise
  const resolvedParams = await params;
  const taskId = resolvedParams.taskId;

  const task = (global as any).generationTasks?.[taskId];

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json(task);
}
