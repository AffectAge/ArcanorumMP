import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Flag,
  LogIn,
  LogOut,
  Send,
  Shield,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { GameMap } from "./components/GameMap";
import { useWegoStore } from "./store/wegoStore";

function CountriesDialog({ countries }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button type="button" className="ui-action group px-3 py-2 text-sm">
          <span className="inline-flex items-center gap-2">
            <Users size={16} className="transition-colors group-hover:text-green-500" />
            Страны
          </span>
        </button>
      </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm animate-pop-in" />
          <Dialog.Content className="ui-card animate-fade-up fixed left-1/2 top-1/2 z-50 w-[min(94vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5 text-white">
            <div className="flex items-center justify-between">
              <Dialog.Title className="text-lg font-semibold">Зарегистрированные страны</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className="ui-action p-2">
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>
            <ul className="mt-4 space-y-2">
              {countries.length === 0 ? (
                <li className="text-sm text-zinc-400">Стран пока нет.</li>
            ) : (
              countries.map((country) => (
                <li key={country.id} className="ui-card flex items-center justify-between rounded-xl px-3 py-2 text-sm">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full animate-pulse-green"
                      style={{ backgroundColor: country.color }}
                    />
                    {country.name}
                  </span>
                  <span className="text-xs text-zinc-500">{country.id.slice(0, 6)}</span>
                </li>
              ))
            )}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function IconDockButton({ label, onClick, children, type = "button" }) {
  return (
    <button type={type} onClick={onClick} className="icon-dock-btn group">
      <span className="transition-colors group-hover:text-green-500">{children}</span>
      <span className="dock-tooltip">{label}</span>
    </button>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState("register");
  const [countryName, setCountryName] = useState("");
  const [countryColor, setCountryColor] = useState("#22C55E");
  const [registerPassword, setRegisterPassword] = useState("");

  const [selectedCountryId, setSelectedCountryId] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const countries = useWegoStore((state) => state.countries);
  const authStatus = useWegoStore((state) => state.authStatus);
  const authError = useWegoStore((state) => state.authError);
  const register = useWegoStore((state) => state.register);
  const login = useWegoStore((state) => state.login);

  const currentSelectedCountryId = selectedCountryId || countries[0]?.id || "";

  return (
    <main className="scanline-bg min-h-screen bg-black text-white">
      <div className="mx-auto flex min-h-screen max-w-4xl items-center px-4 py-8">
        <section className="ui-card ui-card-strong animate-fade-up w-full rounded-2xl p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.26em] text-zinc-400">Arcanorum</p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Командный доступ</h1>
            </div>
            <CountriesDialog countries={countries} />
          </div>

          <p className="mt-3 text-sm text-zinc-400">
            Создай страну с цветом и паролем или войди в уже существующую.
          </p>

          <div className="mt-6 inline-flex rounded-xl border border-zinc-800 bg-black/80 p-1">
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`rounded-lg px-3 py-2 text-sm transition-colors ${mode === "register" ? "bg-zinc-900 text-white" : "text-zinc-400 hover:text-green-500"}`}
            >
              Регистрация
            </button>
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`rounded-lg px-3 py-2 text-sm transition-colors ${mode === "login" ? "bg-zinc-900 text-white" : "text-zinc-400 hover:text-green-500"}`}
            >
              Вход
            </button>
          </div>

          {mode === "register" ? (
            <form
              className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                register({
                  name: countryName,
                  color: countryColor,
                  password: registerPassword,
                });
              }}
            >
              <label className="sr-only" htmlFor="country-name">Страна</label>
              <input
                id="country-name"
                className="ui-input px-3 py-2 text-sm"
                placeholder="Название страны"
                value={countryName}
                onChange={(event) => setCountryName(event.target.value)}
              />
              <input
                type="color"
                className="ui-input h-10 w-full cursor-pointer p-1 md:w-16"
                value={countryColor}
                onChange={(event) => setCountryColor(event.target.value)}
              />
              <label className="sr-only" htmlFor="country-pass">Пароль</label>
              <input
                id="country-pass"
                type="password"
                className="ui-input px-3 py-2 text-sm md:col-span-2"
                placeholder="Пароль"
                value={registerPassword}
                onChange={(event) => setRegisterPassword(event.target.value)}
              />
              <button
                type="submit"
                disabled={authStatus === "auth_loading"}
                className="ui-action group inline-flex items-center justify-center gap-2 px-4 py-2 text-sm md:col-span-2"
              >
                <UserPlus size={16} className="transition-colors group-hover:text-green-500" />
                Создать страну
              </button>
            </form>
          ) : (
            <form
              className="mt-5 grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                login({
                  countryId: currentSelectedCountryId,
                  password: loginPassword,
                });
              }}
            >
              <select
                className="ui-input px-3 py-2 text-sm"
                value={currentSelectedCountryId}
                onChange={(event) => setSelectedCountryId(event.target.value)}
              >
                {countries.length === 0 ? <option value="">Нет доступных стран</option> : null}
                {countries.map((country) => (
                  <option key={country.id} value={country.id}>
                    {country.name}
                  </option>
                ))}
              </select>
              <input
                type="password"
                className="ui-input px-3 py-2 text-sm"
                placeholder="Пароль"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
              />
              <button
                type="submit"
                disabled={authStatus === "auth_loading" || !currentSelectedCountryId}
                className="ui-action group inline-flex items-center justify-center gap-2 px-4 py-2 text-sm"
              >
                <LogIn size={16} className="transition-colors group-hover:text-green-500" />
                Войти в игру
              </button>
            </form>
          )}

          {authError ? (
            <p className="mt-4 text-sm text-red-400">{authError}</p>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function GameScreen() {
  const [ordersText, setOrdersText] = useState("move army_1 north\nhold army_2");
  const [now, setNow] = useState(0);

  const country = useWegoStore((state) => state.country);
  const countries = useWegoStore((state) => state.countries);
  const players = useWegoStore((state) => state.players);
  const phase = useWegoStore((state) => state.phase);
  const turn = useWegoStore((state) => state.turn);
  const phaseEndsAt = useWegoStore((state) => state.phaseEndsAt);
  const status = useWegoStore((state) => state.status);
  const summary = useWegoStore((state) => state.lastResolutionSummary);
  const commitOrders = useWegoStore((state) => state.commitOrders);
  const leaveGame = useWegoStore((state) => state.leaveGame);
  const logout = useWegoStore((state) => state.logout);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const secondsLeft = useMemo(() => {
    if (!phaseEndsAt) {
      return 0;
    }
    return Math.max(0, Math.ceil((phaseEndsAt - now) / 1000));
  }, [phaseEndsAt, now]);

  const onlinePlayers = players.filter((player) => player.connected);
  const phaseRu =
    phase === "planning"
      ? "планирование"
      : phase === "lock"
        ? "блокировка"
        : phase === "resolve"
          ? "резолв"
          : phase === "apply"
            ? "применение"
            : phase;

  return (
    <main className="fixed inset-0 bg-black text-white">
      <GameMap countries={countries} players={players} activeCountryId={country?.id ?? ""} />

      <section className="pointer-events-none absolute inset-0 p-3 sm:p-4">
        <div className="ui-card ui-card-strong animate-fade-up pointer-events-auto w-full rounded-2xl px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-400">
                <Shield size={13} />
                Командование
              </p>
              <h1 className="mt-1 inline-flex items-center gap-2 text-lg font-semibold">
                <Flag size={16} className="text-zinc-300" />
                {country?.name ?? "Неизвестно"}
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: country?.color ?? "#ffffff" }}
                />
              </h1>
              <p className="mt-1 inline-flex items-center gap-3 text-sm text-zinc-300">
                <span>Ход {turn}</span>
                <span>{phaseRu}</span>
                <span className="inline-flex items-center gap-1">
                  <span className="text-zinc-500"><ClockIcon /></span>{secondsLeft}s
                </span>
              </p>
              <p className="mt-1 max-w-2xl text-xs text-zinc-500">{summary}</p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={leaveGame}
                className="ui-action group inline-flex items-center gap-2 px-3 py-2 text-sm"
              >
                <LogIn size={15} className="rotate-180 transition-colors group-hover:text-green-500" />
                Покинуть комнату
              </button>
              <button
                type="button"
                onClick={logout}
                className="ui-action group inline-flex items-center gap-2 px-3 py-2 text-sm"
              >
                <LogOut size={15} className="transition-colors group-hover:text-green-500" />
                Выйти
              </button>
            </div>
          </div>
        </div>

        <aside className="pointer-events-auto absolute left-3 top-1/2 z-20 -translate-y-1/2 sm:left-4">
          <div className="dock-shell animate-fade-up flex flex-col gap-2 rounded-2xl p-2 [animation-delay:120ms]">
            <IconDockButton label="Страна">
              <Flag size={17} />
            </IconDockButton>

            <Dialog.Root>
              <Dialog.Trigger asChild>
                <span>
                  <IconDockButton label="Приказы">
                    <Send size={17} />
                  </IconDockButton>
                </span>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm animate-pop-in" />
                <Dialog.Content className="ui-card ui-card-strong animate-fade-up fixed left-1/2 top-1/2 z-50 w-[min(94vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5 text-white">
                  <div className="flex items-center justify-between">
                    <Dialog.Title className="text-lg font-semibold">Приказы</Dialog.Title>
                    <Dialog.Close asChild>
                      <button type="button" className="ui-action p-2">
                        <X size={16} />
                      </button>
                    </Dialog.Close>
                  </div>
                  <textarea
                    className="ui-input mt-4 h-40 w-full px-3 py-2 text-sm"
                    value={ordersText}
                    onChange={(event) => setOrdersText(event.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => commitOrders(ordersText)}
                    disabled={status !== "connected"}
                    className="ui-action group mt-3 inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-sm disabled:opacity-50"
                  >
                    <Send size={15} className="transition-colors group-hover:text-green-500" />
                    Отправить приказы
                  </button>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>

            <Dialog.Root>
              <Dialog.Trigger asChild>
                <span>
                  <IconDockButton label="Игроки">
                    <Users size={17} />
                  </IconDockButton>
                </span>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm animate-pop-in" />
                <Dialog.Content className="ui-card ui-card-strong animate-fade-up fixed left-1/2 top-1/2 z-50 w-[min(94vw,620px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5 text-white">
                  <div className="flex items-center justify-between">
                    <Dialog.Title className="text-lg font-semibold">Игроки онлайн</Dialog.Title>
                    <Dialog.Close asChild>
                      <button type="button" className="ui-action p-2">
                        <X size={16} />
                      </button>
                    </Dialog.Close>
                  </div>
                  <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                    {onlinePlayers.map((player) => (
                      <li key={player.sessionId} className="ui-card rounded-xl px-3 py-2">
                        <p className="font-medium">
                          <span
                            className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: player.color }}
                          />
                          {player.name}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          submitted {player.hasSubmitted ? "yes" : "no"} ({player.submittedOrderCount})
                        </p>
                      </li>
                    ))}
                    {onlinePlayers.length === 0 ? (
                      <li className="text-sm text-zinc-500">Нет игроков онлайн</li>
                    ) : null}
                  </ul>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </div>
        </aside>
      </section>
    </main>
  );
}

function ClockIcon() {
  return <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500 align-middle" />;
}

function App() {
  const refreshCountries = useWegoStore((state) => state.refreshCountries);
  const authStatus = useWegoStore((state) => state.authStatus);
  const country = useWegoStore((state) => state.country);

  useEffect(() => {
    refreshCountries();
  }, [refreshCountries]);

  if (authStatus === "authenticated" && country) {
    return <GameScreen />;
  }

  return <AuthScreen />;
}

export default App;
