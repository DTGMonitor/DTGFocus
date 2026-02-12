// src/utils/timezoneUtils.ts

export const toUTC = (localTimeString: string, timeZone: string): string | null => {
    if (!localTimeString) return null;

    // 1. Create a Date object
    const inputDate = new Date(localTimeString);

    // 🛡️ SAFETY CHECK: If the date is invalid, stop here.
    if (isNaN(inputDate.getTime())) {
        console.error("toUTC received invalid date:", localTimeString);
        throw new Error(`Invalid Date Format: "${localTimeString}"`);
    }

    // 2. Format to target timezone to calculate offset
    const targetIsoString = inputDate.toLocaleString('en-US', { timeZone });
    const tzDate = new Date(targetIsoString);
    
    // 3. Calculate and apply offset
    const offset = tzDate.getTime() - inputDate.getTime();
    const finalDate = new Date(inputDate.getTime() - offset);

    return finalDate.toISOString();
};

export const fromUTC = (localTimeString: string, timeZone: string): string | null => {
    if (!localTimeString) return null;

    // 1. Create a Date object
    const inputDate = new Date(localTimeString);

    // 🛡️ SAFETY CHECK: If the date is invalid, stop here.
    if (isNaN(inputDate.getTime())) {
        console.error("fromUTC received invalid date:", localTimeString);
        throw new Error(`Invalid Date Format: "${localTimeString}"`);
    }

    // 2. Format to target timezone to calculate offset
    const targetIsoString = inputDate.toLocaleString('en-US', { timeZone });
    const tzDate = new Date(targetIsoString);
    
    // 3. Calculate and apply offset
    const offset = tzDate.getTime() - inputDate.getTime();
    const finalDate = new Date(inputDate.getTime() + offset);

    return finalDate.toISOString();
};

// src/utils/timezoneUtils.ts

export const formatFromUTC = (utcString: string, timeZone: string): string | null => {
    if (!utcString) return null;

    const inputDate = new Date(utcString);

    if (isNaN(inputDate.getTime())) {
        console.error("formatFromUTC received invalid date:", utcString);
        return null;
    }

    // Format the date for the target timezone
    return new Intl.DateTimeFormat('en-AU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZone: timeZone,
        hour12: false // Set to true if you prefer AM/PM
    }).format(inputDate); 
    // Output example: "29/01/2026, 16:44:49"
};