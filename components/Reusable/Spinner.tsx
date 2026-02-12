import { Loader2 } from "lucide-react";

interface SpinnerProps {
  size?: number;      // Optional: default is 32px
  className?: string; // Optional: for extra styling (margin, specific colors)
}

export const Spinner = ({ size = 32, className = "" }: SpinnerProps) => {
  return (
    <Loader2 
      size={size} 
      className={`animate-spin text-[var(--dtg-brand-orange)] ${className}`} 
    />
  );
};

// Optional: A wrapper to perfectly center it in a container
export const PageLoader = () => {
    return (
        <div className="flex-1 flex items-center justify-center min-h-[200px] h-full">
            <Spinner size={40} />
        </div>
    )
}