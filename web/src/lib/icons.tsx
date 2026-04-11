
interface IconProps {
  size?: number;
  className?: string;
}

export function GmailIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <path d="M2 6a2 2 0 012-2h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" fill="currentColor" opacity="0.15" />
      <path d="M2 6l10 7 10-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

export function ChromeIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
      <line x1="12" y1="2" x2="12" y2="8" stroke="currentColor" strokeWidth="1.5" />
      <line x1="3.34" y1="17" x2="8.54" y2="13.46" stroke="currentColor" strokeWidth="1.5" />
      <line x1="20.66" y1="17" x2="15.46" y2="13.46" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function GitHubIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.337-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836a9.59 9.59 0 012.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.416 22 12c0-5.523-4.477-10-10-10z" />
    </svg>
  );
}

export function SignalIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <path d="M12 3C7.03 3 3 6.8 3 11.5c0 1.68.54 3.24 1.47 4.55L3 21l5.19-1.35A9.86 9.86 0 0012 20c4.97 0 9-3.8 9-8.5S16.97 3 12 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="8.5" cy="11.5" r="1" fill="currentColor" />
      <circle cx="12" cy="11.5" r="1" fill="currentColor" />
      <circle cx="15.5" cy="11.5" r="1" fill="currentColor" />
    </svg>
  );
}

export function IMessageIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <path d="M12 3C6.5 3 2 6.58 2 11c0 2.05.86 3.93 2.29 5.37L3 21l4.59-1.69c1.36.44 2.84.69 4.41.69 5.5 0 10-3.58 10-8s-4.5-8-10-8z" fill="currentColor" opacity="0.15" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function AppleNotesIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <rect x="4" y="2" width="16" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <line x1="8" y1="7" x2="16" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="8" y1="11" x2="16" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="8" y1="15" x2="13" y2="15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function GranolaIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <path d="M12 2a3 3 0 00-3 3v4a3 3 0 006 0V5a3 3 0 00-3-3z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M19 10v1a7 7 0 01-14 0v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="9" y1="22" x2="15" y2="22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function CalendarIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" strokeWidth="1.5" />
      <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="16" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function TasksIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <path d="M4 7l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="14" y1="8" x2="20" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4 16l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="14" y1="17" x2="20" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function DriveIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <path d="M8 3l-6 10h8l6-10H8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M16 3l6 10h-8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M2 13l4 8h12l4-8H2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function AiCodingIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 8l3 4-3 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="13" y1="16" x2="17" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function SafariIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function RemindersIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <line x1="12" y1="8.5" x2="17" y2="8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="8.5" cy="13.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <line x1="12" y1="13.5" x2="17" y2="13.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function ContactsIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <rect x="4" y="2" width="16" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 18c0-2.21 1.79-4 4-4s4 1.79 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function ObsidianIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <path d="M12 2L4 7v10l8 5 8-5V7l-8-5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 12L4 7" stroke="currentColor" strokeWidth="1.2" />
      <path d="M12 12l8-5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M12 12v10" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function WhatsAppIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <path d="M12 2C6.48 2 2 6.48 2 12c0 1.82.49 3.53 1.34 5L2 22l5.16-1.34A9.93 9.93 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.5 10.5c0-1.1.9-2 2-2h.5c.83 0 1.5.67 1.5 1.5 0 .55-.3 1.05-.77 1.32L11 12v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="11" cy="15" r="0.75" fill="currentColor" />
    </svg>
  );
}

export function SlackIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <path d="M6 15a2 2 0 01-2-2 2 2 0 012-2h2v2a2 2 0 01-2 2z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9 11h2a2 2 0 002-2V7a2 2 0 00-2-2 2 2 0 00-2 2v4z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M18 9a2 2 0 01-2 2h-2V9a2 2 0 012-2 2 2 0 012 2z" stroke="currentColor" strokeWidth="1.3" />
      <path d="M15 13h-2a2 2 0 00-2 2v2a2 2 0 002 2 2 2 0 002-2v-4z" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function NotionIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <path d="M4 4.5A2.5 2.5 0 016.5 2H14l6 6v11.5a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 19.5v-15z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" />
      <line x1="8" y1="13" x2="16" y2="13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="8" y1="17" x2="13" y2="17" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function SpotifyIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 10.5c2.67-.67 5.33-.33 8 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M8.5 13.5c2.17-.5 4.33-.25 6.5.75" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M9 16.5c1.67-.33 3.33-.17 5 .5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function AppleMusicIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <circle cx="7" cy="17" r="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="17" cy="15" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 17V5l10-2v12" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function HealthIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 8v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ScreenTimeIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <line x1="8" y1="21" x2="16" y2="21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12" y1="17" x2="12" y2="21" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="10" r="3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M12 8.5v1.5l1 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function RecentFilesIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <path d="M4 4h5l2 2h9a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="1.2" />
      <path d="M12 11.5v1.5l1.5.75" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function AppleCalendarIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} fill="none">
      <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" strokeWidth="1.5" />
      <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="7" y="13" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.3" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  );
}
