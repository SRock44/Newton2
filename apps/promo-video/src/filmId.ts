// Every composition mocks `window.fetch` for the desktop app's API calls, and one bundle holds
// all of them. Each composition claims the page when it renders, and each mock only answers while
// its own film is the active one.
export const activeFilm: { id: string } = { id: "" };
