import { useEffect } from 'react';
import { Link, navigate, parseRoute, useLocation } from './lib/router';
import { Search } from './routes/Search';
import { Styleguide } from './routes/Styleguide';
import { Title } from './routes/Title';
import { Card, EmptyState } from './ui';

function Downloads() {
  return (
    <div className="min-h-dvh bg-bg">
      <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-5 md:px-6">
        <Link
          to="/"
          className="inline-flex h-11 items-center gap-1.5 rounded-chip px-3 text-sm font-medium text-muted transition-colors hover:text-fg"
        >
          <span aria-hidden="true">←</span>
          Назад
        </Link>

        <h1 className="mt-6 text-2xl font-bold tracking-tight text-fg">Загрузки</h1>

        <Card className="mt-4">
          <EmptyState
            title="Раздел в разработке"
            description="Список загрузок из Transmission появится в следующей волне."
          />
        </Card>
      </div>
    </div>
  );
}

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

  switch (route.name) {
    case 'styleguide':
      return <Styleguide />;
    case 'title':
      return <Title key={`${route.type}-${route.id}`} type={route.type} id={route.id} />;
    case 'downloads':
      return <Downloads />;
    case 'notFound':
    case 'search':
    default:
      return <Search />;
  }
}
