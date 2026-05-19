import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const workoutPlansTable = pgTable("workout_plans", {
  id: serial("id").primaryKey(),
  sport: text("sport").notNull(),
  experienceLevel: text("experience_level").notNull(),
  age: integer("age").notNull(),
  weight: text("weight"),
  currentStats: text("current_stats").notNull(),
  goals: text("goals").notNull(),
  daysPerWeek: integer("days_per_week").notNull(),
  planContent: text("plan_content").notNull(),
  strengthAssessment: text("strength_assessment"), // JSON stringified StrengthAssessment
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWorkoutPlanSchema = createInsertSchema(workoutPlansTable).omit({ id: true, createdAt: true });
export type InsertWorkoutPlan = z.infer<typeof insertWorkoutPlanSchema>;
export type WorkoutPlan = typeof workoutPlansTable.$inferSelect;
