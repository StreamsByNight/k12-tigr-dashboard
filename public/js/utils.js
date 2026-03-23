export const formatDate = (isoString) => {
    const options = { hour: '2-digit', minute: '2-digit' };
    return new Date(isoString).toLocaleTimeString([], options);
};

export const getDayName = () => {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date());
};
