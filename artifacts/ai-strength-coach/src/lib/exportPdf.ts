import jsPDF from "jspdf";

export interface PdfExportParams {
  sport: string;
  experienceLevel: string;
  age: number;
  weight?: string;
  goals: string;
  daysPerWeek: number;
  assessment?: {
    squat5RM?: string;
    deadlift5RM?: string;
    bench5RM?: string;
    overheadPress5RM?: string;
    maxPushUps?: number;
    bodyweightSquats?: number;
    verticalJump?: string;
    sprintTime?: string;
  };
  planContent: string;
}

export function exportWorkoutPdf(params: PdfExportParams): void {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageW - margin * 2;
  let y = margin;

  const newPageIfNeeded = (needed: number) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  // Title bar
  doc.setFillColor(180, 255, 0); // lime/yellow accent
  doc.rect(0, 0, pageW, 18, "F");
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(10, 10, 10);
  doc.text("AI STRENGTH COACH", margin, 12);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }), pageW - margin, 12, { align: "right" });

  y = 28;

  // Athlete profile section
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(40, 40, 40);
  doc.text("ATHLETE PROFILE", margin, y);
  y += 5;
  doc.setDrawColor(180, 255, 0);
  doc.setLineWidth(0.5);
  doc.line(margin, y, margin + contentWidth, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  
  const profileLines = [
    `Sport: ${params.sport.charAt(0).toUpperCase() + params.sport.slice(1)}`,
    `Experience: ${params.experienceLevel.charAt(0).toUpperCase() + params.experienceLevel.slice(1)}`,
    `Age: ${params.age}${params.weight ? `  |  Weight: ${params.weight}` : ""}`,
    `Training days/week: ${params.daysPerWeek}`,
    `Goals: ${params.goals}`,
  ];
  
  for (const line of profileLines) {
    newPageIfNeeded(7);
    doc.text(line, margin, y);
    y += 6;
  }

  // Strength assessment section (if any data)
  if (params.assessment) {
    const assessRows = [
      params.assessment.squat5RM ? `Squat 5RM: ${params.assessment.squat5RM}` : null,
      params.assessment.deadlift5RM ? `Deadlift 5RM: ${params.assessment.deadlift5RM}` : null,
      params.assessment.bench5RM ? `Bench 5RM: ${params.assessment.bench5RM}` : null,
      params.assessment.overheadPress5RM ? `OHP 5RM: ${params.assessment.overheadPress5RM}` : null,
      params.assessment.maxPushUps != null ? `Max Push-Ups: ${params.assessment.maxPushUps}` : null,
      params.assessment.bodyweightSquats != null ? `BW Squats (1 min): ${params.assessment.bodyweightSquats}` : null,
      params.assessment.verticalJump ? `Vertical Jump: ${params.assessment.verticalJump}` : null,
      params.assessment.sprintTime ? `Sprint: ${params.assessment.sprintTime}` : null,
    ].filter(Boolean) as string[];

    if (assessRows.length > 0) {
      y += 4;
      newPageIfNeeded(12);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(40, 40, 40);
      doc.text("STRENGTH ASSESSMENT", margin, y);
      y += 5;
      doc.setDrawColor(180, 255, 0);
      doc.line(margin, y, margin + contentWidth, y);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(60, 60, 60);
      for (const row of assessRows) {
        newPageIfNeeded(7);
        doc.text(row, margin, y);
        y += 6;
      }
    }
  }

  // Workout plan content
  y += 6;
  newPageIfNeeded(16);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(40, 40, 40);
  doc.text("WORKOUT PROGRAM", margin, y);
  y += 5;
  doc.setDrawColor(180, 255, 0);
  doc.line(margin, y, margin + contentWidth, y);
  y += 8;

  // Render plan content line by line with basic heading detection
  const planLines = params.planContent.split("\n");
  doc.setFontSize(10);

  for (const rawLine of planLines) {
    const line = rawLine.trim();
    if (!line) { y += 3; continue; }

    // Detect headings: lines that are ALL CAPS, or start with "Day ", or are short and contain "—"
    const isMainHeading = /^Day \d/i.test(line) || (line.length < 60 && line.includes("—"));
    const isSubHeading = /^(WARM-UP|MAIN WORKOUT|PROGRAM NOTES|COOL|REST|NOTE)/i.test(line);
    const isBullet = line.startsWith("-") || line.startsWith("•") || line.startsWith("*");

    if (isMainHeading) {
      y += 4;
      newPageIfNeeded(14);
      doc.setFillColor(240, 240, 240);
      doc.rect(margin - 2, y - 5, contentWidth + 4, 9, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(20, 20, 20);
      doc.text(line, margin, y);
      y += 7;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(60, 60, 60);
    } else if (isSubHeading) {
      y += 3;
      newPageIfNeeded(10);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(80, 80, 80);
      const wrappedSub = doc.splitTextToSize(line, contentWidth);
      doc.text(wrappedSub, margin, y);
      y += wrappedSub.length * 5 + 2;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(60, 60, 60);
    } else {
      const indent = isBullet ? margin + 4 : margin;
      const wrappedText = doc.splitTextToSize(line, contentWidth - (isBullet ? 4 : 0));
      newPageIfNeeded(wrappedText.length * 5 + 2);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(60, 60, 60);
      doc.text(wrappedText, indent, y);
      y += wrappedText.length * 5 + 1;
    }
  }

  // Footer on each page
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(160, 160, 160);
    doc.setFont("helvetica", "normal");
    doc.text(`AI Strength Coach — Generated ${new Date().toLocaleDateString()}`, margin, pageH - 8);
    doc.text(`Page ${i} of ${totalPages}`, pageW - margin, pageH - 8, { align: "right" });
  }

  const filename = `${params.sport}-strength-program-${new Date().toISOString().split("T")[0]}.pdf`;
  doc.save(filename);
}