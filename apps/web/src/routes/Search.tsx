import { Button, Card } from '../ui';

export function Search() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-muted">FilmFind</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-fg">Поиск раздач</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Каркас приложения готов. Поиск через TMDB, раздачи из Prowlarr и отправка в Transmission
          появятся в следующих волнах.
        </p>
      </div>

      <Card className="w-full p-4 text-left text-sm leading-relaxed text-muted">
        Уже сейчас можно посмотреть дизайн-систему и макеты всех экранов в стайлгайде.
      </Card>

      <Button
        size="lg"
        onClick={() => {
          window.location.href = '/styleguide';
        }}
      >
        Открыть стайлгайд
      </Button>
    </main>
  );
}
