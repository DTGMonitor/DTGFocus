import React, { useEffect } from "react";

/* -------------------------------------------------------------------------- */
/* ROOT DIALOG                                */
/* -------------------------------------------------------------------------- */
// `onOpenChange` is still accepted by every caller and deliberately ignored:
// nothing outside the panel dismisses the dialog any more. It stays in the
// signature so the prop type callers see keeps accepting it -- dropping it made
// TypeScript reject every `<Dialog onOpenChange={...}>` and fail the build.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const Dialog = ({ open, children, onOpenChange }) => {
  // A dialog is dismissed only from its own Cancel / X control. Neither the
  // backdrop nor Escape closes it: these dialogs hold half-filled forms, and a
  // stray click or keypress outside the panel was throwing that work away.
  useEffect(() => {
    if (open) {
      // Prevent scrolling on the body when modal is open
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* OVERLAY (Dark background) - inert: clicking it must not close the modal */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity" />
      
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