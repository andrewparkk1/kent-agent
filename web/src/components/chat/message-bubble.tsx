import { memo } from "react";
import { motion } from "motion/react";
import { User } from "lucide-react";
import type { Message } from "./types";

export const MessageBubble = memo(function MessageBubble({ msg }: { msg: Message }) {
  return (
    <motion.div
      key={msg.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="flex gap-3 py-3"
    >
      <div className="shrink-0 mt-0.5">
        <div className="w-6 h-6 rounded-md bg-foreground/[0.08] flex items-center justify-center">
          <User size={12} className="text-muted-foreground/60" />
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-medium text-muted-foreground/40 uppercase tracking-wider">
          You
        </span>
        <div className="mt-1 prose-chat">
          {msg.content}
        </div>
      </div>
    </motion.div>
  );
});
