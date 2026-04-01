import { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import Markdown from "react-markdown";

interface PromptFile {
  name: string;
  content: string;
}

export function IdentityPage() {
  const [files, setFiles] = useState<PromptFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch("/api/identity");
      const data = await res.json();
      const entries = Object.entries(data.files).map(([name, content]) => ({
        name,
        content: content as string,
      }));
      // Sort: top-level files first, then skills
      entries.sort((a, b) => {
        const aSkill = a.name.startsWith("skills/") ? 1 : 0;
        const bSkill = b.name.startsWith("skills/") ? 1 : 0;
        if (aSkill !== bSkill) return aSkill - bSkill;
        return a.name.localeCompare(b.name);
      });
      setFiles(entries);
      if (!selected && entries.length > 0) {
        setSelected(entries[0]!.name);
        setEditContent(entries[0]!.content);
      }
    } catch {}
  }, [selected]);

  useEffect(() => { fetchFiles(); }, []);

  const selectFile = (name: string) => {
    const file = files.find((f) => f.name === name);
    if (file) {
      setSelected(name);
      setEditContent(file.content);
      setDirty(false);
    }
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await fetch("/api/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file: selected, content: editContent }),
      });
      setFiles((prev) =>
        prev.map((f) => (f.name === selected ? { ...f, content: editContent } : f))
      );
      setDirty(false);
    } catch {}
    setSaving(false);
  };

  const selectedFile = files.find((f) => f.name === selected);

  return (
    <div className="flex-1 flex flex-col h-screen">
      <div className="px-8 pt-8 pb-4">
        <motion.h1
          className="text-[32px] font-display tracking-tight mb-1"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          Identity
        </motion.h1>
        <motion.p
          className="text-[13px] text-muted-foreground/60"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.3 }}
        >
          Your prompt files in ~/.kent/prompts/ — edit to shape Kent's personality and behavior.
        </motion.p>
      </div>

      <div className="flex-1 flex min-h-0 px-8 pb-8 gap-5">
        {/* File list */}
        <div className="w-[200px] shrink-0">
          <div className="space-y-0.5">
            {files.map((f) => {
              const isSkill = f.name.startsWith("skills/");
              const display = isSkill ? f.name.replace("skills/", "↳ ") : f.name;
              return (
                <button
                  key={f.name}
                  onClick={() => selectFile(f.name)}
                  className={`w-full text-left px-3 py-1.5 rounded-md text-[13px] transition-colors cursor-pointer ${
                    selected === f.name
                      ? "bg-foreground/[0.07] text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]"
                  } ${isSkill ? "pl-5" : ""}`}
                >
                  {display}
                </button>
              );
            })}
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col min-h-0">
          {selectedFile && (
            <>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[13px] font-mono text-muted-foreground">
                  ~/.kent/prompts/{selected}
                </span>
                <span className="text-[11px] text-muted-foreground/30">Ask Kent to update it for you!</span>
              </div>
              <div className="flex-1 overflow-y-auto bg-foreground/[0.02] border border-border/40 rounded-lg p-6 prose prose-sm prose-neutral max-w-none prose-headings:text-foreground prose-headings:font-medium prose-h1:text-[18px] prose-h1:mb-2 prose-h1:mt-6 first:prose-h1:mt-0 prose-h2:text-[15px] prose-h2:mb-1.5 prose-h2:mt-5 prose-h3:text-[14px] prose-h3:mb-1 prose-h3:mt-4 prose-p:text-[13px] prose-p:text-foreground/80 prose-p:leading-relaxed prose-p:my-1.5 prose-li:text-[13px] prose-li:text-foreground/80 prose-li:my-0.5 prose-ul:my-2 prose-ol:my-2 prose-strong:text-foreground prose-code:text-[12px] prose-code:bg-foreground/[0.06] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:before:content-none prose-code:after:content-none prose-pre:bg-foreground/[0.04] prose-pre:border prose-pre:border-border/40 prose-pre:rounded-lg prose-pre:text-[12px] prose-pre:leading-relaxed prose-hr:border-border/40 prose-hr:my-4">
                <Markdown breaks>{editContent}</Markdown>
              </div>
            </>
          )}
          {!selectedFile && files.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-[13px] text-muted-foreground/40">
              No prompt files found. Run <code className="mx-1 px-1.5 py-0.5 bg-foreground/5 rounded text-[12px]">kent init</code> to install them.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
