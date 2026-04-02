import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Moon, Sun, ChevronLeft, ChevronRight, Calendar, Loader2 } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { timeAgo } from "@/lib/types";

interface BriefRun {
  id: string;
  workflow_name: string;
  workflow_description: string;
  output: string;
  started_at: number;
  finished_at: number | null;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDisplayDate(dateStr: string): string {
  const today = new Date();
  const todayStr = toDateStr(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = toDateStr(yesterday);

  if (dateStr === todayStr) return "Today";
  if (dateStr === yesterdayStr) return "Yesterday";

  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatFullDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

// ─── Date Picker Popover ──────────────────────────────────────────────────

function DatePicker({ dates, selected, onSelect, onClose }: {
  dates: string[];
  selected: string;
  onSelect: (d: string) => void;
  onClose: () => void;
}) {
  const months = new Map<string, string[]>();
  for (const d of dates) {
    const key = d.slice(0, 7);
    if (!months.has(key)) months.set(key, []);
    months.get(key)!.push(d);
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: -4, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: 0.97 }}
        transition={{ duration: 0.15 }}
        className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 bg-background border border-border/70 rounded-xl shadow-lg p-3 min-w-[220px] max-h-[300px] overflow-y-auto"
      >
        {dates.length === 0 ? (
          <p className="text-[12px] text-muted-foreground/40 text-center py-3">No briefs yet</p>
        ) : (
          [...months.entries()].map(([monthKey, monthDates]) => {
            const monthLabel = new Date(monthKey + "-15").toLocaleDateString("en-US", { month: "long", year: "numeric" });
            return (
              <div key={monthKey} className="mb-2 last:mb-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/40 px-2 py-1">
                  {monthLabel}
                </div>
                {monthDates.map((d) => (
                  <button
                    key={d}
                    onClick={() => { onSelect(d); onClose(); }}
                    className={`w-full text-left px-2 py-1.5 rounded-lg text-[13px] transition-colors cursor-pointer ${
                      d === selected
                        ? "bg-foreground/[0.07] text-foreground font-medium"
                        : "text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.03]"
                    }`}
                  >
                    {formatDisplayDate(d)}
                    <span className="text-[11px] text-muted-foreground/30 ml-2">
                      {new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" })}
                    </span>
                  </button>
                ))}
              </div>
            );
          })
        )}
      </motion.div>
    </>
  );
}

// ─── Home Page ────────────────────────────────────────────────────────────

export function HomePage() {
  const [briefs, setBriefs] = useState<BriefRun[]>([]);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(toDateStr(new Date()));
  const [activeType, setActiveType] = useState<"morning" | "evening" | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [direction, setDirection] = useState(0);

  const morningBrief = briefs.find((b) => b.workflow_name.includes("morning")) || null;
  const eveningBrief = briefs.find((b) => b.workflow_name.includes("evening")) || null;
  const hasBoth = !!morningBrief && !!eveningBrief;

  // The currently displayed brief
  const activeBrief = activeType === "morning" ? morningBrief
    : activeType === "evening" ? eveningBrief
    : null;

  const fetchBrief = useCallback(async (date?: string) => {
    setLoading(true);
    try {
      const params = date ? `?date=${date}` : "";
      const res = await fetch(`/api/brief${params}`);
      const data = await res.json();
      const fetched: BriefRun[] = data.briefs || [];
      setBriefs(fetched);
      setAvailableDates(data.dates || []);

      // If no date specified, set selected to the date of the first brief
      if (!date && fetched.length > 0) {
        setSelectedDate(toDateStr(new Date(fetched[0].started_at * 1000)));
      }

      // Auto-select the most recent brief type
      if (fetched.length > 0) {
        const latest = fetched[0];
        setActiveType(latest.workflow_name.includes("morning") ? "morning" : "evening");
      } else {
        setActiveType(null);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchBrief(); }, [fetchBrief]);

  const navigateDate = (offset: number) => {
    const idx = availableDates.indexOf(selectedDate);
    const newIdx = idx + offset;
    if (newIdx >= 0 && newIdx < availableDates.length) {
      setDirection(offset > 0 ? -1 : 1);
      const newDate = availableDates[newIdx]!;
      setSelectedDate(newDate);
      fetchBrief(newDate);
    }
  };

  const selectDate = (date: string) => {
    const oldIdx = availableDates.indexOf(selectedDate);
    const newIdx = availableDates.indexOf(date);
    setDirection(newIdx > oldIdx ? -1 : 1);
    setSelectedDate(date);
    fetchBrief(date);
  };

  const canGoNewer = availableDates.indexOf(selectedDate) > 0;
  const canGoOlder = availableDates.indexOf(selectedDate) < availableDates.length - 1;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const isToday = selectedDate === toDateStr(new Date());

  // ─── Loading ─────────────────────────────────────────────────
  if (loading && briefs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="text-muted-foreground/30 animate-spin" />
      </div>
    );
  }

  // ─── Empty state (no briefs at all) ──────────────────────────
  if (briefs.length === 0 && availableDates.length === 0) {
    return (
      <div className="max-w-[900px] mx-auto px-8 py-10">
        <motion.h1
          className="text-[36px] font-display tracking-tight mb-2"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          {greeting}
        </motion.h1>
        <motion.p
          className="text-[14px] text-muted-foreground/50 leading-relaxed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.4 }}
        >
          No briefings yet. Your morning brief or evening recap will appear here once a workflow runs.
        </motion.p>
      </div>
    );
  }

  // ─── Brief content ──────────────────────────────────────────
  return (
    <div className="max-w-[900px] mx-auto px-8 py-10">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        <h1 className="text-[36px] font-display tracking-tight mb-1">
          {isToday ? greeting : formatFullDate(selectedDate)}
        </h1>

        <div className="flex items-center gap-3">
          {/* Date + brief type subtitle */}
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground/50">
            {isToday ? (
              <span>{formatFullDate(selectedDate)}</span>
            ) : (
              <span>{timeAgo(activeBrief?.started_at ?? Date.now() / 1000)}</span>
            )}
            {activeBrief && (
              <>
                <span className="text-muted-foreground/20">·</span>
                <span className="flex items-center gap-1">
                  {activeBrief.workflow_name.includes("morning")
                    ? <><Sun size={11} className="text-amber-500/70" /> Morning Brief</>
                    : <><Moon size={11} className="text-indigo-400/70" /> Evening Recap</>
                  }
                </span>
              </>
            )}
          </div>

          <div className="flex-1" />

          {/* Controls */}
          <div className="flex items-center gap-0.5">
            {hasBoth && (
              <button
                onClick={() => setActiveType(activeType === "morning" ? "evening" : "morning")}
                className="p-1.5 rounded-lg hover:bg-foreground/[0.05] transition-colors cursor-pointer text-muted-foreground/40 hover:text-muted-foreground"
                title={activeType === "morning" ? "Switch to evening recap" : "Switch to morning brief"}
              >
                {activeType === "morning"
                  ? <Moon size={14} className="text-indigo-400" />
                  : <Sun size={14} className="text-amber-500" />
                }
              </button>
            )}

            <button
              onClick={() => navigateDate(1)}
              disabled={!canGoOlder}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                canGoOlder ? "hover:bg-foreground/[0.05] text-muted-foreground/40 hover:text-muted-foreground" : "text-muted-foreground/10 cursor-default"
              }`}
            >
              <ChevronLeft size={14} />
            </button>

            <div className="relative">
              <button
                onClick={() => setPickerOpen(!pickerOpen)}
                className="p-1.5 rounded-lg hover:bg-foreground/[0.05] transition-colors cursor-pointer text-muted-foreground/40 hover:text-muted-foreground"
                title={formatFullDate(selectedDate)}
              >
                <Calendar size={14} />
              </button>
              <AnimatePresence>
                {pickerOpen && (
                  <DatePicker
                    dates={availableDates}
                    selected={selectedDate}
                    onSelect={selectDate}
                    onClose={() => setPickerOpen(false)}
                  />
                )}
              </AnimatePresence>
            </div>

            <button
              onClick={() => navigateDate(-1)}
              disabled={!canGoNewer}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                canGoNewer ? "hover:bg-foreground/[0.05] text-muted-foreground/40 hover:text-muted-foreground" : "text-muted-foreground/10 cursor-default"
              }`}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </motion.div>

      {/* Divider */}
      <motion.div
        className="h-px bg-border/50 my-5"
        initial={{ scaleX: 0, originX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ delay: 0.2, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      />

      {/* Active brief */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${selectedDate}-${activeType}`}
          initial={{ opacity: 0, x: direction * 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: direction * -20 }}
          transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          {!activeBrief ? (
            <div className="py-16 text-center">
              <Calendar size={28} className="mx-auto mb-3 text-muted-foreground/15" />
              <p className="text-[13px] text-muted-foreground/40">No briefs for this day</p>
            </div>
          ) : (
            <div className="prose-brief">
              <Markdown remarkPlugins={[remarkGfm]}>{activeBrief.output}</Markdown>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
