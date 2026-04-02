import { useState } from "react";
import { ChevronDown, ChevronRight, Settings2 } from "lucide-react";
import Markdown from "react-markdown";

export function SystemPromptBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-[11px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors cursor-pointer py-1.5 px-3 rounded-lg bg-foreground/[0.02] border border-border/30 hover:border-border/50 w-full"
      >
        <Settings2 size={12} />
        <span className="font-medium">System Prompt</span>
        <span className="ml-auto">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
      </button>
      {open && (
        <div className="mt-2 text-[11px] text-muted-foreground/50 leading-relaxed px-3 py-3 bg-foreground/[0.02] border border-border/20 rounded-lg max-h-[400px] overflow-y-auto prose-chat prose-sm">
          <Markdown>{content}</Markdown>
        </div>
      )}
    </div>
  );
}
