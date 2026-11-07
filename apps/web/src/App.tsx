import { useEffect, useState } from 'react';
import { Search } from './routes/Search';
import { Styleguide } from './routes/Styleguide';

/** Минимальный path-роутер без зависимостей: приложение маленькое, пока хватает. */
export default function App() {
  const [path, setPath] = useState<string>(() => window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  if (path === '/styleguide' || path === '/styleguide/') {
    return <Styleguide />;
  }

  return <Search />;
}
