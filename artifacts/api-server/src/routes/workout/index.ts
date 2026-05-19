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
        strengthAssessment: body.strengthAssessment
          ? JSON.stringify(body.strengthAssessment)
          : null,
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

  const { sport, experienceLevel, age, weight, currentStats, goals, daysPerWeek, strengthAssessment } = parsed.data;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Build strength assessment context for the AI
  let assessmentContext = "";
  let trainingMaxContext = "";

  if (strengthAssessment) {
    const lines: string[] = [];

    if (strengthAssessment.squat5RM) {
      lines.push(`Squat 5RM: ${strengthAssessment.squat5RM}`);
      trainingMaxContext += `\n- Squat training max (~85% of estimated 1RM): calculate from "${strengthAssessment.squat5RM}" using Brzycki formula`;
    }
    if (strengthAssessment.deadlift5RM) {
      lines.push(`Deadlift 5RM: ${strengthAssessment.deadlift5RM}`);
      trainingMaxContext += `\n- Deadlift training max (~85% of estimated 1RM): calculate from "${strengthAssessment.deadlift5RM}"`;
    }
    if (strengthAssessment.bench5RM) {
      lines.push(`Bench Press 5RM: ${strengthAssessment.bench5RM}`);
      trainingMaxContext += `\n- Bench training max (~85% of estimated 1RM): calculate from "${strengthAssessment.bench5RM}"`;
    }
    if (strengthAssessment.overheadPress5RM) {
      lines.push(`Overhead Press 5RM: ${strengthAssessment.overheadPress5RM}`);
      trainingMaxContext += `\n- OHP training max (~85% of estimated 1RM): calculate from "${strengthAssessment.overheadPress5RM}"`;
    }
    if (strengthAssessment.maxPushUps != null) {
      lines.push(`Max push-ups: ${strengthAssessment.maxPushUps}`);
    }
    if (strengthAssessment.bodyweightSquats != null) {
      lines.push(`Bodyweight squats (1 min): ${strengthAssessment.bodyweightSquats}`);
    }
    if (strengthAssessment.verticalJump) {
      lines.push(`Vertical jump: ${strengthAssessment.verticalJump}`);
    }
    if (strengthAssessment.sprintTime) {
      lines.push(`Sprint time: ${strengthAssessment.sprintTime}`);
    }

    if (lines.length > 0) {
      assessmentContext = `\nStrength Assessment Results:\n${lines.join("\n")}`;
    }
  }

  const hasAssessment = assessmentContext.length > 0;

  const systemPrompt = `You are a professional strength and conditioning coach with expertise in sport-specific performance training. Create clear, structured, and safe weightlifting programs that directly support athletic performance.

Format requirements — follow exactly:
1. Each training day begins with a clearly labeled WARM-UP section (5–10 min)
   - Format: "WARM-UP (5–10 min)" as a heading
   - Include: light cardio (2–3 min), dynamic mobility movements, and 2–3 sport-specific activation exercises
   - Keep warm-up brief and practical

2. Main workout section follows immediately after warm-up
   - Format: "MAIN WORKOUT" as a heading
   - For each exercise:
     * Exercise name
     * Sets × Reps${hasAssessment ? "\n     * Recommended weight (calculated from athlete's test results)" : ""}
     * Rest: X min
     * Coach's note (1 line, practical)

3. Day headings: "Day N — [Focus Area]" (e.g., "Day 1 — Lower Body Power")

4. End with a "PROGRAM NOTES" section (4–6 sentences) explaining why this plan suits the athlete's sport and goals.

${hasAssessment ? `When prescribing weights:
- Use the Brzycki formula to estimate 1RM from provided test data: 1RM = weight × (36 / (37 - reps))
- Use 70–85% of estimated 1RM for working sets (lower % for beginners, higher for advanced)
- For exercises where no direct test data exists, use relative descriptors based on athlete level (e.g., "~60–70% of estimated squat 1RM" or "moderate — RPE 7")
- Express weights in the same units the athlete used in their assessment
- Always include a safety note when loading is near the athlete's tested maximum` : ""}

Language: direct, specific, coach-to-athlete. No fluff.`;

  const userPrompt = `Create a personalized weightlifting program for this athlete:

Sport: ${sport}
Experience Level: ${experienceLevel}
Age: ${age}${weight ? `\nBodyweight: ${weight}` : ""}
Current Performance Stats: ${currentStats}
Goals: ${goals}
Training days available: ${daysPerWeek} days/week${assessmentContext}${hasAssessment ? `

Training max targets (use Brzycki formula on the test data above):${trainingMaxContext}` : ""}

Design a ${daysPerWeek}-day weekly program. Each day must have a warm-up section followed by the main workout. ${hasAssessment ? "Prescribe specific weights for each exercise based on the assessment results." : "Include intensity guidance (RPE or % effort) for each exercise."} Focus on sport-specific performance gains.`;

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
  let strengthAssessment: object | undefined;
  if (plan.strengthAssessment) {
    try {
      strengthAssessment = JSON.parse(plan.strengthAssessment);
    } catch {
      strengthAssessment = undefined;
    }
  }

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
    strengthAssessment,
    createdAt: plan.createdAt.toISOString(),
  };
}

export default router;
