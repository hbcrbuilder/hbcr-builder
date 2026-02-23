export function createRouter({ screens, initialRoute }) {
  let route = initialRoute;

  return {
    getRoute: () => route,
    go: (next) => { route = next; },
    resolve: () => screens[route] || screens[initialRoute]
  };
}
