import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { workoutPlansTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GenerateWorkoutBody, SaveWorkoutPlanBody, GetWorkoutPlanParams, DeleteWorkoutPlanParams } from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

// List all saved workout plans
router.get("/workout/plans", async (req, res) => {
  try {
    const plans = await db
      .select()
      .from(workoutPlansTable)
      .orderBy(workoutPlansTable.createdAt);
    res.json(plans.map(planToResponse));
  } catch (err) {
    req.log.error({ err }, "Failed to list workout plans");
    res.status(500).json({ error: "Failed to list plans" });
  }
});

// Save a workout plan
router.post("/workout/plans", async (req, res) => {
  const parsed = SaveWorkoutPlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const body = parsed.data;
  try {
    const [plan] = await db
      .insert(workoutPlansTable)
      .values({
        sport: body.sport,
        experienceLevel: body.experienceLevel,
        age: body.age,
        weight: body.weight ?? null,
        currentStats: body.currentStats,
        goals: body.goals,
        daysPerWeek: body.daysPerWeek,
        planContent: body.planContent,
      })
      .returning();
    res.status(201).json(planToResponse(plan));
  } catch (err) {
    req.log.error({ err }, "Failed to save workout plan");
    res.status(500).json({ error: "Failed to save plan" });
  }
});

// Get a single saved plan
router.get("/workout/plans/:id", async (req, res) => {
  const parsed = GetWorkoutPlanParams.safeParse({ id: parseInt(req.params.id, 10) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid plan id" });
    return;
  }

  try {
    const [plan] = await db
      .select()
      .from(workoutPlansTable)
      .where(eq(workoutPlansTable.id, parsed.data.id));

    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }
    res.json(planToResponse(plan));
  } catch (err) {
    req.log.error({ err }, "Failed to get workout plan");
    res.status(500).json({ error: "Failed to get plan" });
  }
});

// Delete a saved plan
router.delete("/workout/plans/:id", async (req, res) => {
  const parsed = DeleteWorkoutPlanParams.safeParse({ id: parseInt(req.params.id, 10) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid plan id" });
    return;
  }

  try {
    const result = await db
      .delete(workoutPlansTable)
      .where(eq(workoutPlansTable.id, parsed.data.id))
      .returning();

    if (result.length === 0) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Failed to delete workout plan");
    res.status(500).json({ error: "Failed to delete plan" });
  }
});

// Generate a workout plan (SSE streaming)
router.post("/workout/generate", async (req, res) => {
  const parsed = GenerateWorkoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const { sport, experienceLevel, age, weight, currentStats, goals, daysPerWeek } = parsed.data;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const systemPrompt = `You are a professional strength and conditioning coach with expertise in sport-specific performance training. Create clear, structured, and effective weightlifting programs that directly support athletic performance.

Format guidelines:
- Use clear headings for each day (e.g., "Day 1 — Lower Body Power")
- For each exercise list: exercise name, sets x reps, rest time, and a brief coaching note
- End with a short summary explaining why this program fits the athlete's sport and goals
- Keep language direct and practical — coaches speak in specifics`;

  const userPrompt = `Create a personalized weightlifting program for this athlete:

Sport: ${sport}
Experience Level: ${experienceLevel}
Age: ${age}${weight ? `\nWeight: ${weight}` : ""}
Current Stats: ${currentStats}
Goals: ${goals}
Days per week available: ${daysPerWeek}

Focus on improving performance for their sport. Include compound lifts, sport-specific training, and clear sets/reps/rest periods. Structure the plan across ${daysPerWeek} training days with appropriate recovery. Keep it practical and easy to follow.`;

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "Failed to generate workout plan");
    res.write(`data: ${JSON.stringify({ error: "Failed to generate plan" })}\n\n`);
    res.end();
  }
});

function planToResponse(plan: typeof workoutPlansTable.$inferSelect) {
  return {
    id: plan.id,
    sport: plan.sport,
    experienceLevel: plan.experienceLevel,
    age: plan.age,
    weight: plan.weight,
    currentStats: plan.currentStats,
    goals: plan.goals,
    daysPerWeek: plan.daysPerWeek,
    planContent: plan.planContent,
    createdAt: plan.createdAt.toISOString(),
  };
}

export default router;
