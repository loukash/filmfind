import { useEffect } from 'react';
import { TokenDialog } from './components/TokenDialog';
import { navigate, parseRoute, useLocation } from './lib/router';
import { Downloads } from './routes/Downloads';
import { Search } from './routes/Search';
import { Styleguide } from './routes/Styleguide';
import { Title } from './routes/Title';

export default function App() {
  const location = useLocation();
  const route = parseRoute(location.pathname);

  // Неизвестный путь не должен показывать белый экран: уводим на поиск,
  // заменяя запись в истории, чтобы «назад» не возвращал в тупик.
  useEffect(() => {
    if (route.name === 'notFound') {
      navigate('/', { replace: true });
    }
  }, [route.name, location.pathname]);

  // Стайлгайд — витрина дизайн-системы, без шапки и без доступа к API.
  if (route.name === 'styleguide') {
    return <Styleguide />;
  }

  const screen = (() => {
    switch (route.name) {
      case 'title':
        return <Title key={`${route.type}-${route.id}`} type={route.type} id={route.id} />;
      case 'downloads':
        return <Downloads />;
      case 'notFound':
      case 'search':
      default:
        return <Search />;
    }
  })();

  return (
    <>
      {screen}
      {/* Появляется только после настоящего 401 от /api/*. */}
      <TokenDialog />
    </>
  );
}
