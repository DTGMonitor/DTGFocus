import React, { useEffect, useRef } from "react";
import { X } from "lucide-react"; // Ensure you have lucide-react or use a simple SVG

/* -------------------------------------------------------------------------- */
/* ROOT DIALOG                                */
/* -------------------------------------------------------------------------- */
export const Dialog = ({ open, onOpenChange, children }) => {
  // Handle "Escape" key to close
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      // Prevent scrolling on the body when modal is open
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* OVERLAY (Dark background) - Clicking this closes the modal */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity" 
        onClick={() => onOpenChange(false)}
      />
      
      {/* CONTENT WRAPPER */}
      <div className="z-50 w-full">
        {children}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* DIALOG CONTENT                               */
/* -------------------------------------------------------------------------- */
export const DialogContent = ({ children, className = "" }) => {
  return (
    <div 
      className={`
        relative mx-auto w-full max-w-lg rounded-lg border bg-[var(--dtg-bg-card)] border-[var(--dtg-border-medium)] p-6 shadow-lg 
        duration-200 animate-in fade-in-0 zoom-in-95 
         ${className}
      `}
      onClick={(e) => e.stopPropagation()} // Stop clicks inside from closing modal
    >
      {children}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* DIALOG HEADER                               */
/* -------------------------------------------------------------------------- */
export const DialogHeader = ({ children, className = "" }) => {
  return (
    <div className={`flex flex-col space-y-1.5 text-center sm:text-left mb-4 ${className}`}>
      {children}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* DIALOG TITLE                                */
/* -------------------------------------------------------------------------- */
export const DialogTitle = ({ children, className = "" }) => {
  return (
    <h2 className={`text-lg font-semibold leading-none tracking-tight ${className}`}>
      {children}
    </h2>
  );
};

/* -------------------------------------------------------------------------- */
/* DIALOG FOOTER                               */
/* -------------------------------------------------------------------------- */
export const DialogFooter = ({ children, className = "" }) => {
  return (
    <div className={`flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-4 ${className}`}>
      {children}
    </div>
  );
};