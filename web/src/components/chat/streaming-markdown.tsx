import { useState, useRef, useEffect } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function StreamingMarkdown({ content }: { content: string }) {
  const [rendered, setRendered] = useState(content);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(content);
  latestRef.current = content;

  useEffect(() => {
    if (!timerRef.current) {
      setRendered(content);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setRendered(latestRef.current);
      }, 150);
    }
    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [content]);

  useEffect(() => {
    return () => { setRendered(latestRef.current); };
  }, []);

  return <Markdown remarkPlugins={[remarkGfm]}>{rendered}</Markdown>;
}
