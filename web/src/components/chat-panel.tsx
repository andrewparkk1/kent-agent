import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ArrowUp, Sparkles } from "lucide-react";

export function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [message, setMessage] = useState("");

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 320, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="shrink-0 border-l border-border/40 flex flex-col h-screen sticky top-0 overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-border/40">
            <div className="flex items-center gap-2.5">
              <span className="text-[12px] font-semibold tracking-[0.06em] uppercase text-muted-foreground/60">Chat</span>
              <span className="text-[11px] font-mono text-muted-foreground/30">KE</span>
            </div>
            <motion.button
              whileHover={{ rotate: 90 }}
              transition={{ duration: 0.2 }}
              onClick={onClose}
              className="p-1 rounded-md hover:bg-foreground/5 text-muted-foreground/40 hover:text-foreground transition-colors cursor-pointer"
            >
              <X size={14} />
            </motion.button>
          </div>

          <div className="flex-1 flex flex-col items-center justify-center px-8">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="text-center"
            >
              <div className="w-10 h-10 rounded-full bg-foreground/[0.04] flex items-center justify-center mx-auto mb-4">
                <Sparkles size={18} className="text-muted-foreground/30" />
              </div>
              <p className="text-[13px] text-muted-foreground/50 leading-relaxed">
                What workflows would you like to schedule?
              </p>
            </motion.div>
          </div>

          <div className="px-3 pb-2">
            <div className="flex gap-1.5 flex-wrap">
              {["Create workflow", "Suggest workflows"].map((label) => (
                <button key={label} className="text-[11px] px-2.5 py-1.5 rounded-lg border border-border/50 text-muted-foreground/50 hover:text-foreground hover:border-border hover:bg-card transition-all duration-200 cursor-pointer">
                  {label}
                </button>
              ))}
            </div>
            <button className="w-full text-[11px] py-1.5 text-muted-foreground/30 hover:text-muted-foreground transition-colors mt-1 cursor-pointer">
              Show all schedules
            </button>
          </div>

          <div className="p-3 border-t border-border/40">
            <div className="flex items-center gap-2">
              <input
                className="flex-1 h-9 px-3 text-[13px] bg-foreground/[0.03] border border-border/50 rounded-lg outline-none placeholder:text-muted-foreground/35 focus:border-foreground/15 focus:bg-card input-focus-glow transition-all duration-200"
                placeholder="What workflows would you like to..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="h-9 w-9 flex items-center justify-center rounded-lg bg-foreground text-background shrink-0 cursor-pointer"
              >
                <ArrowUp size={14} strokeWidth={2.5} />
              </motion.button>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
