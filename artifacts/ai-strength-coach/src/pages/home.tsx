import React, { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { 
  useListWorkoutPlans, 
  useSaveWorkoutPlan, 
  useDeleteWorkoutPlan, 
  getListWorkoutPlansQueryKey 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dumbbell, History, Trash2, Zap, ArrowRight, Save, Play, FileDown } from "lucide-react";
import { exportWorkoutPdf } from "@/lib/exportPdf";

const formSchema = z.object({
  sport: z.string().min(1, "Sport is required"),
  experienceLevel: z.string().min(1, "Experience level is required"),
  age: z.coerce.number().min(14).max(100),
  weight: z.string().optional(),
  currentStats: z.string().min(10, "Provide some current stats"),
  goals: z.string().min(10, "Provide your goals"),
  daysPerWeek: z.coerce.number().min(1).max(7)
});

type FormValues = z.infer<typeof formSchema>;

const assessmentSchema = z.object({
  squat5RM: z.string().optional(),
  deadlift5RM: z.string().optional(),
  bench5RM: z.string().optional(),
  overheadPress5RM: z.string().optional(),
  maxPushUps: z.coerce.number().optional(),
  bodyweightSquats: z.coerce.number().optional(),
  verticalJump: z.string().optional(),
  sprintTime: z.string().optional(),
});
type AssessmentValues = z.infer<typeof assessmentSchema>;

function hasAnyAssessmentData(a: AssessmentValues): boolean {
  return !!(a.squat5RM || a.deadlift5RM || a.bench5RM || a.overheadPress5RM || a.maxPushUps || a.bodyweightSquats || a.verticalJump || a.sprintTime);
}

type AssessmentFieldKey = keyof AssessmentValues;

interface AssessmentFieldConfig {
  key: AssessmentFieldKey;
  label: string;
  placeholder: string;
  type: "text" | "number";
}

interface SportAssessmentConfig {
  description: string;
  fields: AssessmentFieldConfig[];
}

const SPORT_ASSESSMENT_CONFIG: Record<string, SportAssessmentConfig> = {
  cycling: {
    description: "Cycling performance is built on leg power, hip drive, and muscular endurance. These tests calibrate your posterior chain and quad strength to prescribe the right training loads.",
    fields: [
      { key: "squat5RM", label: "Back Squat (5-rep set)", placeholder: "e.g. 135 lbs × 5", type: "text" },
      { key: "deadlift5RM", label: "Deadlift (5-rep set)", placeholder: "e.g. 185 lbs × 5", type: "text" },
      { key: "bodyweightSquats", label: "Bodyweight Squats (1 min)", placeholder: "e.g. 45", type: "number" },
      { key: "verticalJump", label: "Vertical Jump (power proxy)", placeholder: "e.g. 22 inches", type: "text" },
    ],
  },
  running: {
    description: "Running strength work is built around single-leg stability, injury prevention, and posterior chain development. These tests pinpoint your weak links so the program targets them directly.",
    fields: [
      { key: "squat5RM", label: "Squat (5-rep set)", placeholder: "e.g. 135 lbs × 5", type: "text" },
      { key: "deadlift5RM", label: "RDL / Deadlift (5-rep set)", placeholder: "e.g. 155 lbs × 5", type: "text" },
      { key: "maxPushUps", label: "Max Push-Ups (unbroken)", placeholder: "e.g. 25", type: "number" },
      { key: "bodyweightSquats", label: "Single-Leg Squat Reps (each leg)", placeholder: "e.g. 8", type: "number" },
      { key: "sprintTime", label: "Sprint Time", placeholder: "e.g. 4.9s (40 yards)", type: "text" },
    ],
  },
  soccer: {
    description: "Soccer demands explosive acceleration, hamstring resilience, and multi-directional power. Hamstring injury prevention is a core priority — these tests identify your strength baseline for each key quality.",
    fields: [
      { key: "squat5RM", label: "Squat (5-rep set)", placeholder: "e.g. 145 lbs × 5", type: "text" },
      { key: "deadlift5RM", label: "Deadlift / Hip Thrust (5-rep set)", placeholder: "e.g. 185 lbs × 5", type: "text" },
      { key: "maxPushUps", label: "Max Push-Ups (unbroken)", placeholder: "e.g. 30", type: "number" },
      { key: "bodyweightSquats", label: "Bodyweight Squats (1 min)", placeholder: "e.g. 45", type: "number" },
      { key: "verticalJump", label: "Vertical Jump", placeholder: "e.g. 22 inches", type: "text" },
      { key: "sprintTime", label: "10m / 40yd Sprint Time", placeholder: "e.g. 4.8s (40 yards)", type: "text" },
    ],
  },
  basketball: {
    description: "Basketball training revolves around vertical jump, reactive strength, and upper body power for physicality. Vertical jump is your primary metric — every exercise is selected to improve it.",
    fields: [
      { key: "squat5RM", label: "Squat (5-rep set)", placeholder: "e.g. 145 lbs × 5", type: "text" },
      { key: "bench5RM", label: "Bench Press (5-rep set)", placeholder: "e.g. 115 lbs × 5", type: "text" },
      { key: "maxPushUps", label: "Max Push-Ups (unbroken)", placeholder: "e.g. 30", type: "number" },
      { key: "verticalJump", label: "Vertical Jump", placeholder: "e.g. 26 inches", type: "text" },
      { key: "bodyweightSquats", label: "Bodyweight Squats (1 min)", placeholder: "e.g. 45", type: "number" },
      { key: "sprintTime", label: "Lane Sprint / 3/4-Court", placeholder: "e.g. 3.2s", type: "text" },
    ],
  },
  powerlifting: {
    description: "Powerlifting is defined by squat, bench, and deadlift. Enter your best 5-rep sets and we'll calculate precise training maxes using the Brzycki formula.",
    fields: [
      { key: "squat5RM", label: "Back Squat (5-rep set)", placeholder: "e.g. 225 lbs × 5", type: "text" },
      { key: "deadlift5RM", label: "Deadlift (5-rep set)", placeholder: "e.g. 315 lbs × 5", type: "text" },
      { key: "bench5RM", label: "Bench Press (5-rep set)", placeholder: "e.g. 185 lbs × 5", type: "text" },
      { key: "overheadPress5RM", label: "Overhead Press (5-rep set)", placeholder: "e.g. 115 lbs × 5", type: "text" },
    ],
  },
  swimming: {
    description: "Swimming strength work targets lat strength for the pull phase, rotator cuff health (the sport's most common injury site), hip flexors for kick power, and core rotation. Upper body dominates the assessment.",
    fields: [
      { key: "maxPushUps", label: "Max Pull-Ups or Push-Ups (unbroken)", placeholder: "e.g. 12 pull-ups", type: "number" },
      { key: "overheadPress5RM", label: "Overhead Press (5-rep set)", placeholder: "e.g. 75 lbs × 5", type: "text" },
      { key: "deadlift5RM", label: "RDL / Hip Hinge (5-rep set)", placeholder: "e.g. 135 lbs × 5", type: "text" },
      { key: "bodyweightSquats", label: "Plank Hold (seconds)", placeholder: "e.g. 90", type: "number" },
      { key: "sprintTime", label: "25m Sprint Swim Time (opt)", placeholder: "e.g. 14.2s", type: "text" },
    ],
  },
  tennis: {
    description: "Tennis is driven by rotational power in the serve and groundstrokes, shoulder external rotation strength (injury prevention), and lateral agility. These tests identify your rotational base and shoulder balance.",
    fields: [
      { key: "overheadPress5RM", label: "Overhead Press (5-rep set)", placeholder: "e.g. 75 lbs × 5", type: "text" },
      { key: "deadlift5RM", label: "RDL / Deadlift (5-rep set)", placeholder: "e.g. 155 lbs × 5", type: "text" },
      { key: "maxPushUps", label: "Max Push-Ups (unbroken)", placeholder: "e.g. 25", type: "number" },
      { key: "bodyweightSquats", label: "Lateral Bounds (total reps, 30s)", placeholder: "e.g. 24", type: "number" },
      { key: "sprintTime", label: "5m Lateral Shuffle Sprint", placeholder: "e.g. 2.1s", type: "text" },
    ],
  },
  wrestling: {
    description: "Wrestling demands pulling strength, explosive hips, grip endurance, and full-body durability under load. Deadlift and row strength are your primary performance indicators.",
    fields: [
      { key: "deadlift5RM", label: "Deadlift (5-rep set)", placeholder: "e.g. 275 lbs × 5", type: "text" },
      { key: "bench5RM", label: "Bench Press (5-rep set)", placeholder: "e.g. 165 lbs × 5", type: "text" },
      { key: "squat5RM", label: "Squat (5-rep set)", placeholder: "e.g. 185 lbs × 5", type: "text" },
      { key: "maxPushUps", label: "Max Pull-Ups (unbroken)", placeholder: "e.g. 10", type: "number" },
      { key: "bodyweightSquats", label: "Bodyweight Squats (1 min)", placeholder: "e.g. 50", type: "number" },
    ],
  },
  volleyball: {
    description: "Volleyball training revolves around vertical jump (blocking/spiking), shoulder strength and rotator cuff health (serving/spiking), and explosive landing mechanics. Vertical jump is your primary target.",
    fields: [
      { key: "squat5RM", label: "Squat (5-rep set)", placeholder: "e.g. 135 lbs × 5", type: "text" },
      { key: "overheadPress5RM", label: "Overhead Press (5-rep set)", placeholder: "e.g. 75 lbs × 5", type: "text" },
      { key: "maxPushUps", label: "Max Push-Ups (unbroken)", placeholder: "e.g. 25", type: "number" },
      { key: "verticalJump", label: "Vertical Jump", placeholder: "e.g. 24 inches", type: "text" },
      { key: "bodyweightSquats", label: "Bodyweight Squats (1 min)", placeholder: "e.g. 45", type: "number" },
    ],
  },
  baseball: {
    description: "Baseball/softball performance is built on rotational hip power (hitting), shoulder health for throwing longevity, and hip-to-shoulder separation. Asymmetry correction is baked into the program.",
    fields: [
      { key: "deadlift5RM", label: "Trap Bar Deadlift / RDL (5-rep set)", placeholder: "e.g. 185 lbs × 5", type: "text" },
      { key: "bench5RM", label: "Bench Press (5-rep set)", placeholder: "e.g. 135 lbs × 5", type: "text" },
      { key: "overheadPress5RM", label: "Overhead Press (5-rep set)", placeholder: "e.g. 75 lbs × 5", type: "text" },
      { key: "maxPushUps", label: "Max Push-Ups (unbroken)", placeholder: "e.g. 25", type: "number" },
      { key: "sprintTime", label: "60-Foot Sprint (baseball) or 40yd", placeholder: "e.g. 6.8s (60 ft)", type: "text" },
    ],
  },
  golf: {
    description: "Golf performance depends on rotational mobility and power, hip stability as a base for the swing, and thoracic spine mobility. Lower back injury prevention is a top priority.",
    fields: [
      { key: "deadlift5RM", label: "RDL / Hip Hinge (5-rep set)", placeholder: "e.g. 135 lbs × 5", type: "text" },
      { key: "squat5RM", label: "Squat (5-rep set)", placeholder: "e.g. 115 lbs × 5", type: "text" },
      { key: "maxPushUps", label: "Max Push-Ups (unbroken)", placeholder: "e.g. 20", type: "number" },
      { key: "bodyweightSquats", label: "Single-Leg Balance Hold (seconds)", placeholder: "e.g. 45", type: "number" },
      { key: "verticalJump", label: "Seated Med Ball Throw Distance (opt)", placeholder: "e.g. 12 ft", type: "text" },
    ],
  },
  mma: {
    description: "MMA demands explosive full-body power for striking and takedowns, pulling/grip strength for grappling, and durability under anaerobic fatigue. These tests cover all three pillars.",
    fields: [
      { key: "deadlift5RM", label: "Deadlift (5-rep set)", placeholder: "e.g. 245 lbs × 5", type: "text" },
      { key: "bench5RM", label: "Bench Press (5-rep set)", placeholder: "e.g. 155 lbs × 5", type: "text" },
      { key: "squat5RM", label: "Squat (5-rep set)", placeholder: "e.g. 185 lbs × 5", type: "text" },
      { key: "maxPushUps", label: "Max Pull-Ups (unbroken)", placeholder: "e.g. 8", type: "number" },
      { key: "bodyweightSquats", label: "Burpees (1 min)", placeholder: "e.g. 20", type: "number" },
      { key: "sprintTime", label: "400m Run Time (conditioning baseline)", placeholder: "e.g. 72s", type: "text" },
    ],
  },
  weightlifting: {
    description: "Olympic weightlifting is built on explosive hip extension, front squat strength as the base, and overhead stability. If you have a snatch or clean & jerk max, enter it — otherwise use squat and deadlift.",
    fields: [
      { key: "squat5RM", label: "Front Squat (5-rep set)", placeholder: "e.g. 155 lbs × 5", type: "text" },
      { key: "deadlift5RM", label: "Deadlift / Clean Pull (5-rep set)", placeholder: "e.g. 225 lbs × 5", type: "text" },
      { key: "overheadPress5RM", label: "Overhead Press (5-rep set)", placeholder: "e.g. 95 lbs × 5", type: "text" },
      { key: "verticalJump", label: "Vertical Jump (power proxy)", placeholder: "e.g. 24 inches", type: "text" },
      { key: "sprintTime", label: "Snatch / C&J Max (if known)", placeholder: "e.g. Snatch 135 lbs", type: "text" },
    ],
  },
  general: {
    description: "A balanced assessment across all major movement patterns gives the AI the data it needs to prescribe precise weights for every exercise.",
    fields: [
      { key: "squat5RM", label: "Squat (5-rep set)", placeholder: "e.g. 135 lbs × 5", type: "text" },
      { key: "deadlift5RM", label: "Deadlift (5-rep set)", placeholder: "e.g. 185 lbs × 5", type: "text" },
      { key: "bench5RM", label: "Bench Press (5-rep set)", placeholder: "e.g. 115 lbs × 5", type: "text" },
      { key: "overheadPress5RM", label: "Overhead Press (5-rep set)", placeholder: "e.g. 75 lbs × 5", type: "text" },
      { key: "maxPushUps", label: "Max Push-Ups (unbroken)", placeholder: "e.g. 30", type: "number" },
      { key: "bodyweightSquats", label: "Bodyweight Squats (1 min)", placeholder: "e.g. 45", type: "number" },
    ],
  },
};

const DEFAULT_ASSESSMENT_CONFIG: SportAssessmentConfig = {
  description: "Enter your best recent test results. These are used to calculate personalized working weights. Leave any field blank and the AI will use RPE guidelines instead.",
  fields: [
    { key: "squat5RM", label: "Squat (5-rep set)", placeholder: "e.g. 135 lbs × 5", type: "text" },
    { key: "deadlift5RM", label: "Deadlift (5-rep set)", placeholder: "e.g. 185 lbs × 5", type: "text" },
    { key: "bench5RM", label: "Bench Press (5-rep set)", placeholder: "e.g. 115 lbs × 5", type: "text" },
    { key: "maxPushUps", label: "Max Push-Ups (unbroken)", placeholder: "e.g. 30", type: "number" },
    { key: "bodyweightSquats", label: "Bodyweight Squats (1 min)", placeholder: "e.g. 45", type: "number" },
  ],
};

export default function Home() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"profile" | "assessment" | "plan">("profile");
  const [profileData, setProfileData] = useState<FormValues | null>(null);
  const [assessmentData, setAssessmentData] = useState<AssessmentValues | null>(null);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamedPlan, setStreamedPlan] = useState("");
  const [currentRequest, setCurrentRequest] = useState<{ profile: FormValues; assessment: AssessmentValues } | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [viewingSavedPlan, setViewingSavedPlan] = useState<any>(null);

  const { data: savedPlans, isLoading: isLoadingPlans } = useListWorkoutPlans();
  const savePlanMutation = useSaveWorkoutPlan();
  const deletePlanMutation = useDeleteWorkoutPlan();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      sport: "",
      experienceLevel: "",
      age: 25,
      weight: "",
      currentStats: "",
      goals: "",
      daysPerWeek: 3
    }
  });

  const assessmentForm = useForm<AssessmentValues>({
    resolver: zodResolver(assessmentSchema),
    defaultValues: {
      squat5RM: "",
      deadlift5RM: "",
      bench5RM: "",
      overheadPress5RM: "",
      maxPushUps: undefined,
      bodyweightSquats: undefined,
      verticalJump: "",
      sprintTime: "",
    }
  });

  const onProfileSubmit = (values: FormValues) => {
    setProfileData(values);
    setStep("assessment");
  };

  const generatePlan = async (profile: FormValues, assessment: AssessmentValues) => {
    setIsGenerating(true);
    setStreamedPlan("");
    setCurrentRequest({ profile, assessment });
    setViewingSavedPlan(null);
    setStep("plan");

    try {
      const payload = {
        ...profile,
        strengthAssessment: hasAnyAssessmentData(assessment) ? assessment : undefined,
      };

      const BASE = import.meta.env.BASE_URL;
      const response = await fetch(`${BASE}api/workout/generate`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
      });
      
      if (!response.body) throw new Error("No response body");
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6));
              if (json.done) break;
              if (json.content) setStreamedPlan(prev => prev + json.content);
            } catch (e) {
              // ignore parse error for incomplete chunks
            }
          }
        }
      }
    } catch (error) {
      toast({ title: "Error generating plan", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = () => {
    if (!currentRequest || !streamedPlan) return;
    
    savePlanMutation.mutate({
      data: {
        ...currentRequest.profile,
        planContent: streamedPlan,
        strengthAssessment: currentRequest.assessment && hasAnyAssessmentData(currentRequest.assessment)
          ? currentRequest.assessment
          : undefined,
      }
    }, {
      onSuccess: () => {
        toast({ title: "Plan saved successfully" });
        queryClient.invalidateQueries({ queryKey: getListWorkoutPlansQueryKey() });
      },
      onError: () => {
        toast({ title: "Failed to save plan", variant: "destructive" });
      }
    });
  };

  const handleDelete = (id: number) => {
    deletePlanMutation.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Plan deleted" });
        queryClient.invalidateQueries({ queryKey: getListWorkoutPlansQueryKey() });
        if (viewingSavedPlan?.id === id) {
          setViewingSavedPlan(null);
        }
      }
    });
  };

  const activePlanContent = viewingSavedPlan ? viewingSavedPlan.planContent : streamedPlan;
  const isViewingGenerated = (!viewingSavedPlan && streamedPlan.length > 0) || viewingSavedPlan;

  const exportPlan = () => {
    if (!currentRequest || !activePlanContent) return;
    exportWorkoutPdf({
      sport: currentRequest.profile.sport,
      experienceLevel: currentRequest.profile.experienceLevel,
      age: currentRequest.profile.age,
      weight: currentRequest.profile.weight,
      goals: currentRequest.profile.goals,
      daysPerWeek: currentRequest.profile.daysPerWeek,
      assessment: currentRequest.assessment,
      planContent: activePlanContent,
    });
  };

  const exportSavedPlan = () => {
    if (!viewingSavedPlan) return;
    exportWorkoutPdf({
      sport: viewingSavedPlan.sport,
      experienceLevel: viewingSavedPlan.experienceLevel,
      age: viewingSavedPlan.age,
      weight: viewingSavedPlan.weight ?? undefined,
      goals: viewingSavedPlan.goals,
      daysPerWeek: viewingSavedPlan.daysPerWeek,
      assessment: viewingSavedPlan.strengthAssessment as any,
      planContent: viewingSavedPlan.planContent,
    });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Left Column */}
      <div className="w-full md:w-[450px] lg:w-[500px] bg-card border-r border-border p-6 md:p-8 flex flex-col h-screen overflow-y-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary flex items-center justify-center rounded">
              <Zap className="text-primary-foreground w-6 h-6" />
            </div>
            <h1 className="text-4xl font-display uppercase tracking-wider text-foreground m-0 leading-none">AI STRENGTH</h1>
          </div>
          <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="border-border">
                <History className="w-4 h-4" />
              </Button>
            </SheetTrigger>
            <SheetContent className="w-[400px] sm:w-[540px] bg-card border-l-border">
              <SheetHeader className="mb-6">
                <SheetTitle className="text-2xl font-display uppercase tracking-widest text-primary">Saved Plans</SheetTitle>
              </SheetHeader>
              <ScrollArea className="h-[calc(100vh-100px)]">
                {isLoadingPlans ? (
                  <div className="space-y-4">
                    {[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full bg-muted" />)}
                  </div>
                ) : savedPlans?.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No saved plans yet.</p>
                ) : (
                  <div className="space-y-4 pr-4">
                    {savedPlans?.map(plan => (
                      <Card key={plan.id} className="bg-background border-border overflow-hidden group cursor-pointer transition-colors hover:border-primary/50" onClick={() => {
                        setViewingSavedPlan(plan);
                        setIsSheetOpen(false);
                      }}>
                        <div className="p-4 flex justify-between items-start">
                          <div>
                            <h3 className="font-display text-xl text-foreground uppercase tracking-wide">{plan.sport}</h3>
                            <p className="text-xs text-muted-foreground mt-1">{new Date(plan.createdAt).toLocaleDateString()}</p>
                            <p className="text-sm mt-2 text-foreground/80">{plan.experienceLevel} • {plan.daysPerWeek} days/wk</p>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                            onClick={(e) => { e.stopPropagation(); handleDelete(plan.id); }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </SheetContent>
          </Sheet>
        </div>

        {step === "profile" && (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onProfileSubmit)} className="space-y-6 flex-1">
              <div className="space-y-4">
                <h2 className="text-lg font-display text-primary uppercase tracking-widest border-b border-border pb-2">Athlete Profile</h2>
                
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="sport" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground">Sport</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="sport-select" className="bg-background border-border"><SelectValue placeholder="Select" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="cycling">Cycling</SelectItem>
                          <SelectItem value="running">Running</SelectItem>
                          <SelectItem value="soccer">Soccer</SelectItem>
                          <SelectItem value="basketball">Basketball</SelectItem>
                          <SelectItem value="volleyball">Volleyball</SelectItem>
                          <SelectItem value="baseball">Baseball / Softball</SelectItem>
                          <SelectItem value="tennis">Tennis</SelectItem>
                          <SelectItem value="golf">Golf</SelectItem>
                          <SelectItem value="swimming">Swimming</SelectItem>
                          <SelectItem value="wrestling">Wrestling / Grappling</SelectItem>
                          <SelectItem value="mma">MMA / Combat Sports</SelectItem>
                          <SelectItem value="weightlifting">Olympic Weightlifting</SelectItem>
                          <SelectItem value="powerlifting">Powerlifting</SelectItem>
                          <SelectItem value="general">General Fitness</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="experienceLevel" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground">Level</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="experience-select" className="bg-background border-border"><SelectValue placeholder="Select" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="beginner">Beginner</SelectItem>
                          <SelectItem value="intermediate">Intermediate</SelectItem>
                          <SelectItem value="advanced">Advanced</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="age" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground">Age</FormLabel>
                      <FormControl><Input data-testid="age-input" type="number" className="bg-background border-border" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="weight" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground">Weight (opt)</FormLabel>
                      <FormControl><Input data-testid="weight-input" placeholder="e.g. 180 lbs" className="bg-background border-border" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="daysPerWeek" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground">Training Days per Week</FormLabel>
                    <FormControl><Input data-testid="days-input" type="number" min={1} max={7} className="bg-background border-border" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="currentStats" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground">Current Stats / Benchmarks</FormLabel>
                    <FormControl><Textarea data-testid="stats-input" placeholder="Current 1RMs, VO2 max, race pace..." className="bg-background border-border resize-none h-20" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="goals" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground">Specific Goals</FormLabel>
                    <FormControl><Textarea data-testid="goals-input" placeholder="Increase vertical jump, drop 5k time..." className="bg-background border-border resize-none h-20" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <div className="pt-4 mt-auto">
                <Button data-testid="next-assessment-btn" type="submit" className="w-full h-14 text-lg font-display uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/90">
                  Next: Strength Assessment <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
              </div>
            </form>
          </Form>
        )}

        {step === "assessment" && (
          <Form {...assessmentForm}>
            <form className="space-y-6 flex-1 flex flex-col">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <h2 className="text-lg font-display text-primary uppercase tracking-widest m-0">Strength Assessment</h2>
                  <Button data-testid="back-to-profile-btn" variant="link" size="sm" className="h-auto p-0 text-muted-foreground hover:text-foreground" onClick={() => setStep("profile")}>
                    Back
                  </Button>
                </div>
                
                {(() => {
                  const sport = profileData?.sport ?? "";
                  const config = SPORT_ASSESSMENT_CONFIG[sport] ?? DEFAULT_ASSESSMENT_CONFIG;
                  return (
                    <>
                      <p className="text-sm text-muted-foreground">{config.description} Leave any field blank and the AI will use RPE guidelines instead.</p>
                      <div className="grid grid-cols-2 gap-4">
                        {config.fields.map((fc) => (
                          <FormField
                            key={fc.key}
                            control={assessmentForm.control}
                            name={fc.key}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground">{fc.label}</FormLabel>
                                <FormControl>
                                  <Input
                                    data-testid={`assessment-${fc.key}`}
                                    type={fc.type}
                                    placeholder={fc.placeholder}
                                    className="bg-background border-border"
                                    {...field}
                                    value={field.value ?? ""}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        ))}
                      </div>
                    </>
                  );
                })()}
              </div>

              <div className="pt-4 mt-auto flex flex-col gap-3">
                <Button 
                  data-testid="skip-generate-btn"
                  type="button" 
                  variant="outline"
                  className="w-full h-12 text-base font-display uppercase tracking-widest border-border"
                  onClick={() => {
                    const profile = profileData || form.getValues();
                    setProfileData(profile);
                    const emptyAssessment = assessmentForm.getValues();
                    generatePlan(profile, emptyAssessment);
                  }}
                >
                  Skip & Generate
                </Button>
                <Button 
                  data-testid="generate-weights-btn"
                  type="button" 
                  className="w-full h-14 text-lg font-display uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={assessmentForm.handleSubmit((values) => {
                    setAssessmentData(values);
                    const profile = profileData || form.getValues();
                    setProfileData(profile);
                    generatePlan(profile, values);
                  })}
                >
                  Generate with Weights <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
              </div>
            </form>
          </Form>
        )}

        {(step === "plan" || isGenerating) && (
          <div className="space-y-6">
            <h2 className="text-lg font-display text-primary uppercase tracking-widest border-b border-border pb-2">Profile Summary</h2>
            
            <Card className="bg-background border-border">
              <CardContent className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Sport</p>
                    <p className="font-medium capitalize">{profileData?.sport || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Level</p>
                    <p className="font-medium capitalize">{profileData?.experienceLevel || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Age / Weight</p>
                    <p className="font-medium">{profileData?.age || "N/A"} / {profileData?.weight || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Days/Week</p>
                    <p className="font-medium">{profileData?.daysPerWeek || "N/A"}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Goals</p>
                  <p className="font-medium text-sm line-clamp-2">{profileData?.goals || "N/A"}</p>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-3 pt-4">
              <Button 
                data-testid="edit-profile-btn"
                variant="outline" 
                className="flex-1 font-display uppercase tracking-widest"
                onClick={() => {
                  setStep("profile");
                  setStreamedPlan("");
                  setViewingSavedPlan(null);
                  setCurrentRequest(null);
                }}
              >
                Edit Profile
              </Button>
              <Button 
                data-testid="regenerate-summary-btn"
                className="flex-1 font-display uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => {
                  if (profileData) {
                    generatePlan(profileData, assessmentData || assessmentForm.getValues());
                  }
                }}
                disabled={isGenerating}
              >
                Regenerate
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Right Column: Results */}
      <div className="flex-1 bg-background p-6 md:p-10 h-screen overflow-y-auto relative">
        {!activePlanContent && !isGenerating ? (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
            <Dumbbell className="w-24 h-24 mb-6 text-muted-foreground" strokeWidth={1} />
            <h2 className="text-4xl font-display text-muted-foreground uppercase tracking-widest">Ready to Build</h2>
            <p className="text-muted-foreground max-w-md mt-4">Enter your metrics and goals on the left. We'll generate a dense, no-nonsense training cycle specifically for your sport.</p>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto pb-24">
            {viewingSavedPlan && (
              <div className="mb-8 flex items-center justify-between bg-card p-4 rounded-lg border border-border">
                <div>
                  <Badge variant="outline" className="text-primary border-primary/30 mb-2 uppercase tracking-widest font-display">Archived Plan</Badge>
                  <h2 className="text-2xl font-display uppercase tracking-wide">{viewingSavedPlan.sport} Program</h2>
                </div>
                <div className="flex gap-2">
                  <Button data-testid="close-saved-plan-btn" variant="outline" size="sm" onClick={() => {
                    setViewingSavedPlan(null);
                    setStep("profile");
                  }}>Close</Button>
                  <Button data-testid="delete-saved-plan-btn" variant="destructive" size="sm" onClick={() => handleDelete(viewingSavedPlan.id)}>
                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                  </Button>
                </div>
              </div>
            )}
            
            <div className="prose prose-invert prose-p:text-foreground/80 prose-headings:font-display prose-headings:uppercase prose-headings:tracking-widest prose-h1:text-5xl prose-h2:text-3xl prose-h3:text-2xl prose-h3:text-primary max-w-none">
              {isGenerating ? (
                <div className="space-y-8">
                  <div className="flex items-center gap-3 text-primary animate-pulse">
                    <Play className="w-5 h-5" />
                    <span className="font-display text-xl uppercase tracking-widest">Compiling Program...</span>
                  </div>
                  <div className="whitespace-pre-wrap font-sans text-lg leading-relaxed text-foreground/90">
                    {streamedPlan}
                  </div>
                  <div className="space-y-4">
                    <Skeleton className="h-8 w-1/3 bg-muted" />
                    <Skeleton className="h-4 w-full bg-muted" />
                    <Skeleton className="h-4 w-5/6 bg-muted" />
                    <Skeleton className="h-4 w-4/6 bg-muted" />
                  </div>
                </div>
              ) : (
                <div className="whitespace-pre-wrap font-sans text-lg leading-relaxed text-foreground/90">
                  {activePlanContent}
                </div>
              )}
            </div>
            
            {isViewingGenerated && !isGenerating && (
              <div className="fixed bottom-10 right-10 flex gap-4">
                <Button data-testid="regenerate-bottom-btn" variant="outline" size="lg" className="h-12 font-display uppercase tracking-widest text-lg bg-card" onClick={() => {
                    if (viewingSavedPlan) {
                        setViewingSavedPlan(null);
                        setStep("profile");
                    } else if (profileData) {
                        generatePlan(profileData, assessmentData || assessmentForm.getValues());
                    }
                }}>
                  Regenerate
                </Button>
                <Button data-testid="export-pdf-btn" variant="outline" size="lg" className="h-12 font-display uppercase tracking-widest text-lg bg-card" onClick={viewingSavedPlan ? exportSavedPlan : exportPlan}>
                  <FileDown className="w-5 h-5 mr-2" />
                  Export PDF
                </Button>
                {!viewingSavedPlan && (
                  <Button data-testid="save-plan-btn" size="lg" className="h-12 font-display uppercase tracking-widest text-lg bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleSave} disabled={savePlanMutation.isPending}>
                    <Save className="w-5 h-5 mr-2" />
                    {savePlanMutation.isPending ? "Saving..." : "Save Plan"}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Inline Badge component to save time since it might not be exported from lucide
function Badge({ className, variant = "default", ...props }: any) {
  return (
    <div className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${className}`} {...props} />
  )
}
