export const LocalTime = ({ utcTime, format = 'full' }) => {
  const date = new Date(utcTime);

  // Helper values for the manual format
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
  const day = String(date.getDate()).padStart(2, '0');

  const formats = {
    full: date.toLocaleString(),
    date: date.toLocaleDateString(),
    time: date.toLocaleTimeString(),
    // Fixed: returns '20260115' instead of '01/15/26'
    telfer_report: `${year}${month}${day}`, 
    short: date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  };

  return <span>{formats[format]}</span>;
};