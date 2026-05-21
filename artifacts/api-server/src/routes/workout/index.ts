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

  // Sport-specific training science guidance injected into the AI prompt
  const SPORT_GUIDANCE: Record<string, string> = {
    cycling: `SPORT SCIENCE — CYCLING:
- Primary energy system: aerobic (Zone 2 base); explosive efforts use alactic/anaerobic
- Training priority hierarchy: (1) posterior chain leg power, (2) single-leg strength and balance, (3) core anti-rotation for power transfer, (4) upper body only as secondary
- Key exercises to prioritize: back squat, front squat, Bulgarian split squat, hip thrust, RDL, step-ups, single-leg press, goblet squat, plank variations
- Plyometrics: box jumps, jump squats (develop watt output — directly translates to power at the pedal)
- Avoid: heavy overhead pressing (breathing restriction at max effort), excessive upper body mass (power-to-weight ratio), isolated bicep/tricep work
- Critical injury prevention: VMO/quad strength for knee tracking, hip abductors (ITB syndrome), lumbar stability for riding position
- Programming note: rep ranges of 4–8 heavy for strength; add 10–15 rep endurance sets to mirror cycling's muscular endurance demands; unilateral work should dominate`,

    running: `SPORT SCIENCE — RUNNING:
- Primary energy system: aerobic (distance) or mixed alactic+aerobic (sprints/800m)
- Training priority hierarchy: (1) single-leg stability and gluteal strength, (2) posterior chain injury prevention, (3) calf/Achilles tendon stiffness via eccentric loading, (4) hip flexor and abductor strength
- Key exercises: single-leg RDL, Bulgarian split squat, hip thrust, Nordic hamstring curl (evidence-based #1 for hamstring injury prevention), Copenhagen adductor plank, seated/standing calf raise with eccentric emphasis, tibialis anterior raise, hip hinge
- Plyometrics: pogo jumps and bounding (develop Achilles tendon stiffness and ground contact time), single-leg hops
- Avoid: heavy bilateral squats as primary exercise (running is unilateral), exercises that add unnecessary upper body mass
- Critical injury prevention: Achilles tendinopathy (eccentric calf raises 3×15 on decline), hamstring strains (Nordic curls — clinically shown to reduce injury rate >50%), ITB syndrome (hip abductor strengthening), patellofemoral pain (VMO and hip stability)
- Programming note: 2–3 strength sessions/week; moderate loads (RPE 7–8), prioritize single-leg movement patterns in every session`,

    soccer: `SPORT SCIENCE — SOCCER / FOOTBALL:
- Primary energy system: repeated sprint (alactic bursts with aerobic recovery); 60–90 min total duration
- Training priority hierarchy: (1) hamstring strength and injury prevention — THIS IS THE #1 PRIORITY, (2) lower body explosive power, (3) multi-directional agility strength, (4) upper body for physicality
- Key exercises: Nordic hamstring curl (gold standard — 50%+ reduction in hamstring injury in clinical trials), hip thrust, back squat, box jump, depth jump, lateral lunge, sled push, Copenhagen plank (adductor injury prevention)
- Plyometrics: essential — depth jumps, reactive box jumps, broad jumps, lateral bounds (directly improve acceleration and change-of-direction)
- Avoid: excessive upper body bulk (slows acceleration), single-rep max work in-season (CNS fatigue), marathon conditioning in strength sessions
- Critical injury prevention: hamstring (Nordic curls in EVERY session), ACL (landing mechanics coaching cues on all jumps — "soft knees, hip hinge on landing"), groin/adductor (Copenhagen planks 2×/week), ankle
- Programming note: power and speed qualities must be prioritized; strength serves as a foundation for explosiveness, not an end in itself; keep sessions under 60 min`,

    basketball: `SPORT SCIENCE — BASKETBALL:
- Primary energy system: alactic (explosive 1–3 second bursts) with aerobic recovery between plays
- Training priority hierarchy: (1) vertical jump — every session must include a jump training component, (2) reactive/elastic strength (depth jumps, reactive landing), (3) lower body explosive power, (4) upper body for contact and rebounding
- Key exercises: box jump, depth jump, reactive jump (drop and rebound), back squat, hip thrust, Bulgarian split squat, bench press, overhead press, lateral band walks, single-leg RDL
- Plyometrics: MANDATORY in every lower-body session — depth jumps (reactive strength index improvement), box jumps, vertical jump drills (approach jumps, standing jumps)
- Avoid: excessive slow grinding bodybuilding volume (kills explosiveness), heavy grinding singles for non-powerlifters
- Critical injury prevention: ankle (single-leg stability drills), ACL/knee (landing mechanics — always cue "land soft, bend knees" on all jump landings), shoulder impingement (rotator cuff warm-up every session)
- Programming note: structure each lower body session as: heavy strength movement → plyometric block → accessory work; vertical jump should be tested every 4 weeks as the primary outcome metric`,

    powerlifting: `SPORT SCIENCE — POWERLIFTING:
- Sport definition: competition in squat, bench press, and deadlift (and OHP in some federations); goal is maximum 1RM on competition day
- Training priority hierarchy: (1) competition squat, (2) competition bench press, (3) competition deadlift, (4) targeted accessories to fix weak points
- Programming methodology: percentage-based linear or wave periodization (e.g., 3×5 @ 75%, 3×3 @ 80%, 1×1 @ 85% rotating weekly); accessories must address the athlete's specific sticking points
- Key primary exercises: back squat, bench press, deadlift (must be programmed every week with variation — pause, tempo, pin)
- Key accessory exercises: pause squat (builds out of the hole), close-grip bench (tricep lockout), Romanian deadlift (posterior chain), row variations (upper back for bench arch), tricep dips/pushdowns, ab work (bracing)
- Avoid: excessive cardio that bleeds into recovery, exercises that don't serve the competition lifts
- Critical injury prevention: shoulder (rotator cuff warm-up before every bench session; scapular retraction strength), lower back (deadlift bracing — 360° brace cue; limit max singles to peaking phase), knee (quad tendon — do NOT skip warm-up sets)
- Programming note: always program in training blocks (accumulation → intensification → peaking → deload); specify exact percentages for every working set`,

    swimming: `SPORT SCIENCE — SWIMMING:
- Primary energy system: varies by event — sprints (50–100m) are >80% anaerobic; 1500m is >80% aerobic
- Training priority hierarchy: (1) lat and shoulder pulling strength (propulsion in freestyle/butterfly), (2) rotator cuff health — shoulder impingement is the #1 swimming injury, (3) core rotation (hip-to-shoulder connection for stroke efficiency), (4) hip flexor strength (kick power), (5) ankle flexibility (lower priority in gym)
- Key exercises: pull-ups/chin-ups (lat dominant — single most transferable strength exercise), cable rows, single-arm cable pull, overhead press with scapular stability emphasis, face pulls (posterior deltoid and rotator cuff), band external rotation, hanging leg raises, cable woodchops, hip flexor work
- Avoid: excessive chest/anterior deltoid volume without proportional posterior shoulder work (creates impingement risk), heavy barbell pressing without rotator cuff pre-hab, adding significant muscle mass (drag increases)
- Critical injury prevention: shoulder impingement (maintain 2:1 ratio of pulling to pushing volume; face pulls and band ER in every session), internal rotation dominance from stroke mechanics (program external rotation accessory work)
- Programming note: maintain pulling:pushing ratio of at least 2:1; rotator cuff activation must open every session; absolute muscle mass is less important than strength-to-weight and movement quality`,

    tennis: `SPORT SCIENCE — TENNIS:
- Primary energy system: repeated alactic (2–8 second points) with aerobic recovery (15–30s between points)
- Training priority hierarchy: (1) rotational power for serve and groundstrokes — the kinetic chain from ground up, (2) shoulder external rotation strength (injury prevention for serving shoulder), (3) lateral agility and deceleration strength, (4) wrist/forearm for racquet control and injury prevention
- Key exercises: medicine ball rotational slam and throw (most specific transfer to groundstrokes), cable rotation, pallof press, lateral lunge, lateral band walk, RDL, hip thrust, overhead press, face pulls, hammer curls and reverse curls (forearm/elbow), wrist pronation/supination with light weight
- Plyometrics: lateral bounds, split-step landings, first-step reactive drills
- Avoid: heavy bilateral pressing without rotation balance, neglecting the non-dominant arm (creates asymmetry and injury risk), too much slow-twitch volume (kills explosiveness)
- Critical injury prevention: tennis elbow/lateral epicondylitis (eccentric wrist extension work, forearm strengthening), shoulder internal rotation dominance (program ER work — band, face pulls), knee (lateral deceleration loading)
- Programming note: rotational power should be the first strength quality trained in every session; train the full kinetic chain — foot drive → hip rotation → shoulder → arm; never isolate the arm in rotation training`,

    wrestling: `SPORT SCIENCE — WRESTLING / GRAPPLING:
- Primary energy system: anaerobic alactic (explosive shots/throws) + anaerobic lactic (sustained scrambles); matches are 3–7 minutes of near-maximal effort
- Training priority hierarchy: (1) posterior chain and hip explosion (takedown power), (2) upper body pulling strength — rows, chin-ups (clinch/grip), (3) grip and forearm endurance, (4) neck strength (injury prevention), (5) full-body anaerobic conditioning
- Key exercises: deadlift (king of wrestling strength — hip explosion + grip), bent-over row, pull-up/chin-up (maximum pulling strength), power clean or DB power clean (explosive hip extension = takedown power), farmers carry (grip and postural endurance), bear hug (squeeze and lift ability), wrestler's bridge, neck harness or isometric neck work
- Avoid: imbalanced pushing-dominant programs (grapplers need 2:1 pulling); isolated machine work that doesn't build functional tension
- Critical injury prevention: neck (isometric neck strengthening — all four directions; prevents stingers and cervical injury), shoulder (rotator cuff pre-hab; takedown and scramble forces are extreme), knee (single-leg stability)
- Programming note: grip and pulling strength are the primary outputs; strength-to-bodyweight ratio matters more than absolute strength for weight-class sport; include heavy carries and loaded holds for grip endurance`,

    volleyball: `SPORT SCIENCE — VOLLEYBALL:
- Primary energy system: alactic (explosive jump bursts); each point lasts 3–10 seconds with recovery
- Training priority hierarchy: (1) vertical jump — the primary athletic demand (blocking, spiking), (2) shoulder health for spiking/serving longevity — rotator cuff is high injury risk, (3) reactive landing mechanics (ankle and knee injury prevention), (4) core power transfer for spiking motion
- Key exercises: box jump, depth jump, approach jump practice, squat, hip thrust, overhead press with scapular stability emphasis, face pulls and band external rotation (rotator cuff), single-leg landing drills, plyo push-up, core rotation (cable woodchop)
- Plyometrics: mandatory every session — approach jumps (simulating spike approach), depth jumps, repeated vertical jumps, ankle stiffness drills
- Avoid: slow-grinding bodybuilding volume that kills reactive ability, ignoring rotator cuff work (spiking creates chronic internal rotation stress)
- Critical injury prevention: ankle sprain (single-leg stability drills and ankle strengthening; most common injury), ACL (landing mechanics — land with bent knees, hip hinge; avoid knee valgus), shoulder impingement (maintain pulling:pushing ratio ≥ 2:1)
- Programming note: vertical jump testing every 4 weeks is the primary success metric; include plyometric block before strength work when CNS is fresh`,

    baseball: `SPORT SCIENCE — BASEBALL / SOFTBALL:
- Primary energy system: alactic (explosive swing, throw, sprint); rest periods are long (true sport for power development)
- Training priority hierarchy: (1) rotational hip power — the kinetic chain for hitting and throwing, (2) shoulder health for throwing longevity (UCL and rotator cuff), (3) hip-to-shoulder separation (X-factor stretch — prerequisite for bat speed), (4) single-leg stability, (5) asymmetry correction (dominant side overuse)
- Key exercises: hip thrust (hip drive for swing and throw), trap bar deadlift or RDL, rotational medicine ball wall throw (most specific to hitting mechanics), cable rotation, overhead press, face pulls and band ER (throwing shoulder pre-hab), lateral lunge, single-leg RDL, anti-rotation plank and pallof press
- Plyometrics: rotational power — medicine ball slams, rotational throws; sprint starts (first-step quickness for base running and fielding)
- Avoid: heavy benching without posterior shoulder balance (pitcher's shoulder demands careful management), any exercise that reduces hip or thoracic rotation range of motion
- Critical injury prevention: UCL / Tommy John (lat and rotator cuff strength supports elbow valgus forces during throw), shoulder impingement (balance internal and external rotation strength; face pulls EVERY session), lower back (limit excessive lumbar rotation loading; anti-rotation core work)
- Programming note: program hip rotation mechanics as a primary movement category; always pair dominant-side rotational work with non-dominant-side work to correct asymmetry; upper body volume must be managed carefully for pitchers/throwers`,

    golf: `SPORT SCIENCE — GOLF:
- Primary energy system: alactic (explosive club-head speed) + aerobic walking base; the swing itself takes <0.3 seconds
- Training priority hierarchy: (1) hip-to-shoulder separation — the "X-factor stretch" creates clubhead speed; this is the primary athletic quality, (2) rotational mobility AND power (must have both), (3) glute and hip stability as the base for the swing, (4) thoracic spine mobility, (5) lower back injury prevention — #1 golf injury
- Key exercises: hip thrust and glute bridge (glute activation for stable swing base), RDL and trap bar deadlift (hip hinge and posterior chain), cable rotation and medicine ball rotational throw (swing-specific power), pallof press (anti-rotation stability), thoracic rotation drill, half-kneeling exercises, single-leg deadlift (hip stability in follow-through), farmer's carry
- Avoid: exercises that reduce rotation range of motion (heavy bilateral squats without mobility complement), excessive spinal flexion under load (sit-ups — increases lumbar injury risk), any exercise that creates thoracic stiffness
- Critical injury prevention: lumbar spine (most common golf injury — thoracic mobility and hip rotation should be adequate so lumbar doesn't compensate; anti-rotation core work), lateral epicondylitis (wrist and forearm strengthening), hip (hip mobility and external rotation flexibility)
- Programming note: every session must include a thoracic mobility warm-up and hip rotation activation; strength is a means to generate clubhead speed — ensure ROM is not sacrificed for load; measure driver distance and accuracy as primary outcome`,

    mma: `SPORT SCIENCE — MMA / COMBAT SPORTS:
- Primary energy system: mixed — alactic (explosive strikes, takedowns) + anaerobic lactic (sustained scrambles) + aerobic (recovery and late-round pacing); fights are 3–5 rounds × 5 minutes
- Training priority hierarchy: (1) explosive hip power (striking and takedowns), (2) upper body pulling/grip (clinch, grappling), (3) full-body durability and structural strength, (4) anaerobic conditioning capacity
- Key exercises: deadlift (hip power and grip — transfers to clinch and takedowns), power clean or kettlebell swing (explosive hip extension = strike/takedown power), bench press, barbell/DB row, pull-ups, farmer's carry (grip and conditioning), sled push (alactic conditioning), front squat (structural strength and core bracing)
- Conditioning integration: strength sessions should end with a metabolic finisher (e.g., 3 rounds × 1 min of KB swings + battle ropes) to simulate fight conditioning
- Avoid: excessive slow bodybuilding volume that adds mass without improving power-to-weight ratio; single-plane movements that don't reflect the multi-directional demands of fighting
- Critical injury prevention: shoulder (rotator cuff and posterior shoulder work — takedowns and submissions stress the shoulder capsule), neck (isometric strengthening in all four planes), knee (landing mechanics and lateral movement loading)
- Programming note: power and strength must be built first; conditioning is done in separate sessions; in-season programming must account for technical training volume (drilling and sparring) — keep gym sessions short and high-quality`,

    weightlifting: `SPORT SCIENCE — OLYMPIC WEIGHTLIFTING:
- Sport definition: competition in the snatch and clean & jerk; goal is maximum barbell lifted overhead in each movement
- Training priority hierarchy: (1) snatch and clean & jerk technique and strength (these ARE the sport), (2) front squat and overhead squat (foundation for receiving position), (3) posterior chain pulling strength (clean pull, snatch pull, RDL), (4) overhead stability and jerk drive
- Key exercises: full snatch, power snatch, hang snatch, clean & jerk, power clean, hang clean, front squat, overhead squat, back squat (general strength base), clean pull, snatch pull, RDL, push press (jerk assistance), strict overhead press (shoulder stability)
- Note: if athlete does not have access to technique coaching, program power-based alternatives (power cleans, push press, box jumps) as proxies for the competition movements
- Avoid: excessive bodybuilding accessories that add non-functional mass; programs that neglect the overhead receiving position (most common weakness)
- Critical injury prevention: wrist (rack position flexibility; wrist wraps and daily mobility), shoulder (overhead stability — face pulls and band ER; catching in clean/jerk requires extreme shoulder stability), lower back (deadlift bracing discipline; never round under fatigue)
- Programming note: percentage-based programming tied to competition lifts (e.g., snatch at 75–90% for technique work, clean & jerk at 80–90% for strength); front squat and snatch/clean pull must be programmed weekly; peaking for competition follows a 4–6 week intensification block`,

    general: `SPORT SCIENCE — GENERAL FITNESS:
- Goal: broad physical preparedness — strength, mobility, body composition, and longevity
- Training priority hierarchy: (1) compound movements for full-body strength, (2) balance of pushing and pulling, (3) lower body bilateral and unilateral, (4) core stability
- Key exercises: squat, deadlift, bench press, overhead press, pull-up/row, lunge, Romanian deadlift, plank
- Plyometrics: light box jumps and medicine ball work for power and athleticism
- Avoid: programming that neglects any major movement pattern; imbalanced pushing-dominant programs
- Injury prevention: balanced programming with 1:1 push:pull ratio; hip hinge in every session; posterior chain work
- Programming note: follow a balanced upper/lower or push/pull/legs split; prioritize progressive overload on the main compound lifts; include accessory work to address individual weak points`,
  };

  const sportGuidance = SPORT_GUIDANCE[sport] ?? SPORT_GUIDANCE["general"];

  const systemPrompt = `You are a professional strength and conditioning coach with deep expertise in sport-specific performance training. You apply evidence-based training science to create programs that directly improve athletic performance for each specific sport.

${sportGuidance}

FORMAT REQUIREMENTS — follow exactly:
1. Each training day begins with a sport-specific WARM-UP section (8–12 min)
   - Format: "WARM-UP (8–12 min)" as a heading
   - Include: (a) 3 min light cardio/movement prep relevant to the sport, (b) 3–4 dynamic mobility movements targeting the sport's primary joints, (c) 2–3 activation exercises targeting the sport's key muscle groups
   - Warm-up should be sport-specific, not generic

2. Main workout follows immediately
   - Format: "MAIN WORKOUT" as a heading
   - For each exercise:
     * Exercise name
     * Sets × Reps${hasAssessment ? "\n     * Recommended weight (calculated from athlete's test results)" : ""}
     * Rest: X min
     * Coach's note (1 line — explain WHY this exercise matters for this specific sport)

3. Day headings: "Day N — [Sport-Specific Focus]" (e.g., "Day 1 — Posterior Chain Power" for cycling, or "Day 1 — Vertical Jump Development" for basketball)

4. End with a "PROGRAM NOTES" section (5–7 sentences) covering:
   - Why each training emphasis was chosen for this sport
   - Key injury prevention priorities and how the program addresses them
   - How to progress after 4–6 weeks

${hasAssessment ? `When prescribing weights:
- Use the Brzycki formula to estimate 1RM from test data: 1RM = weight × (36 / (37 - reps))
- Use 70–85% of estimated 1RM for working sets (lower % for beginners, higher for advanced)
- For exercises without direct test data, use relative descriptors (e.g., "~65% of estimated squat 1RM" or "RPE 7–8")
- Express weights in the same units the athlete used in their assessment
- Note any exercise where loading is near the athlete's tested ceiling` : ""}

Language: direct, specific, coach-to-athlete. Every exercise selection must be justifiable by the sport's demands. No filler exercises.`;

  const userPrompt = `Create a sport-specific strength and conditioning program for this athlete:

Sport: ${sport}
Experience Level: ${experienceLevel}
Age: ${age}${weight ? `\nBodyweight: ${weight}` : ""}
Current Performance Stats: ${currentStats}
Goals: ${goals}
Training days available: ${daysPerWeek} days/week${assessmentContext}${hasAssessment ? `

Training max targets (Brzycki formula from test data above):${trainingMaxContext}` : ""}

Design a ${daysPerWeek}-day weekly training split. Apply the sport-specific training priorities above. Each day must have a sport-specific warm-up then the main workout. ${hasAssessment ? "Prescribe exact weights for each exercise using the athlete's test results." : "Include RPE and % intensity targets for every exercise."} Every exercise selection must directly serve this athlete's sport performance or injury prevention needs.`;

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
