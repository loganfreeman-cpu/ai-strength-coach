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
import { Dumbbell, History, Trash2, Zap, ArrowRight, Save, Play } from "lucide-react";

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

export default function Home() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamedPlan, setStreamedPlan] = useState("");
  const [currentRequest, setCurrentRequest] = useState<FormValues | null>(null);
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

  const generatePlan = async (values: FormValues) => {
    setIsGenerating(true);
    setStreamedPlan("");
    setCurrentRequest(values);
    setViewingSavedPlan(null);

    try {
      const BASE = import.meta.env.BASE_URL;
      const response = await fetch(`${BASE}api/workout/generate`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(values) 
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
        ...currentRequest,
        planContent: streamedPlan
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
  const isViewingGenerated = !viewingSavedPlan && streamedPlan.length > 0;

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Left Column: Form */}
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

        <Form {...form}>
          <form onSubmit={form.handleSubmit(generatePlan)} className="space-y-6 flex-1">
            <div className="space-y-4">
              <h2 className="text-lg font-display text-primary uppercase tracking-widest border-b border-border pb-2">Athlete Profile</h2>
              
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="sport" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground">Sport</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-background border-border"><SelectValue placeholder="Select" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="cycling">Cycling</SelectItem>
                        <SelectItem value="running">Running</SelectItem>
                        <SelectItem value="soccer">Soccer</SelectItem>
                        <SelectItem value="basketball">Basketball</SelectItem>
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
                        <SelectTrigger className="bg-background border-border"><SelectValue placeholder="Select" /></SelectTrigger>
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
                    <FormControl><Input type="number" className="bg-background border-border" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="weight" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground">Weight (opt)</FormLabel>
                    <FormControl><Input placeholder="e.g. 180 lbs" className="bg-background border-border" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="daysPerWeek" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground">Training Days per Week</FormLabel>
                  <FormControl><Input type="number" min={1} max={7} className="bg-background border-border" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="currentStats" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground">Current Stats / Benchmarks</FormLabel>
                  <FormControl><Textarea placeholder="Current 1RMs, VO2 max, race pace..." className="bg-background border-border resize-none h-20" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="goals" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs uppercase tracking-wider text-muted-foreground">Specific Goals</FormLabel>
                  <FormControl><Textarea placeholder="Increase vertical jump, drop 5k time..." className="bg-background border-border resize-none h-20" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="pt-4 mt-auto">
              <Button type="submit" disabled={isGenerating} className="w-full h-14 text-lg font-display uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/90">
                {isGenerating ? "Generating..." : "Generate Program"}
                {!isGenerating && <ArrowRight className="ml-2 w-5 h-5" />}
              </Button>
            </div>
          </form>
        </Form>
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
                  <Button variant="outline" size="sm" onClick={() => setViewingSavedPlan(null)}>Close</Button>
                  <Button variant="destructive" size="sm" onClick={() => handleDelete(viewingSavedPlan.id)}>
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
                <Button variant="outline" size="lg" className="h-12 font-display uppercase tracking-widest text-lg bg-card" onClick={() => form.handleSubmit(generatePlan)()}>
                  Regenerate
                </Button>
                <Button size="lg" className="h-12 font-display uppercase tracking-widest text-lg bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleSave} disabled={savePlanMutation.isPending}>
                  <Save className="w-5 h-5 mr-2" />
                  {savePlanMutation.isPending ? "Saving..." : "Save Plan"}
                </Button>
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
