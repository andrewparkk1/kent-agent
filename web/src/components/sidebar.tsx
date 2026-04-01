import { motion } from "motion/react";
import {
  Home, Zap, Activity, MessageCircle, Plus,
  Database, UserCircle, Settings, Brain,
} from "lucide-react";
import kentIcon from "@/assets/icon.png";
import type { Page } from "@/lib/types";

const NAV_MAIN = [
  { id: "home" as Page, icon: Home, label: "Home" },
  { id: "workflows" as Page, icon: Zap, label: "Workflows" },
  { id: "activity" as Page, icon: Activity, label: "Activity" },
];

const NAV_DATA = [
  { id: "identity" as Page, icon: UserCircle, label: "Identity" },
  { id: "sources" as Page, icon: Database, label: "Sources" },
  { id: "memories" as Page, icon: Brain, label: "Memories" },
  { id: "settings" as Page, icon: Settings, label: "Settings" },
];

function NavButton({ item, active, onClick, badge }: { item: { id: Page; icon: typeof Home; label: string }; active: boolean; onClick: () => void; badge?: React.ReactNode }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      className={`group relative w-full flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] transition-all duration-200 cursor-pointer ${
        active ? "bg-foreground/[0.06] text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]"
      }`}
    >
      {active && (
        <motion.div
          layoutId="nav-indicator"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-full bg-foreground/70"
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      )}
      <Icon size={15} strokeWidth={active ? 2 : 1.5} />
      <span className="flex-1 text-left">{item.label}</span>
      {badge}
    </button>
  );
}

export function Sidebar({ page, setPage, activityCount }: { page: Page; setPage: (p: Page) => void; activityCount: number }) {
  return (
    <aside className="w-[220px] shrink-0 border-r border-border/60 flex flex-col h-screen sticky top-0">
      <div className="px-5 pt-6 pb-5 flex items-center gap-3">
        <img src={kentIcon} alt="Kent" className="h-7 w-7 rounded-md" />
        <span className="text-[15px] font-semibold tracking-tight">Kent</span>
      </div>

      <nav className="flex-1 px-3 overflow-y-auto">
        <div className="space-y-0.5">
          {NAV_MAIN.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={page === item.id}
              onClick={() => setPage(item.id)}
              badge={item.id === "activity" && activityCount > 0 ? (
                <span className="text-[11px] font-mono text-muted-foreground/70 tabular-nums">{activityCount}</span>
              ) : undefined}
            />
          ))}
        </div>

        <div className="mt-6 mb-1">
          <div className="flex items-center justify-between px-3 mb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/50">Chats</span>
            <button className="p-0.5 rounded hover:bg-foreground/5 text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-pointer">
              <Plus size={12} />
            </button>
          </div>
          <button className="w-full flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03] transition-all duration-200 cursor-pointer">
            <MessageCircle size={15} strokeWidth={1.5} />
            <span>New chat</span>
          </button>
        </div>

        <div className="mt-6">
          <div className="px-3 mb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/50">Data</span>
          </div>
          <div className="space-y-0.5">
            {NAV_DATA.map((item) => (
              <NavButton key={item.id} item={item} active={page === item.id} onClick={() => setPage(item.id)} />
            ))}
          </div>
        </div>
      </nav>
    </aside>
  );
}
