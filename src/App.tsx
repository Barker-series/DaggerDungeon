import { useGameStore } from './store/gameStore';
import { MainMenu } from './ui/MainMenu';
import { GameScreen } from './ui/GameScreen';
import './style.css';

function App() {
  const screen = useGameStore((s) => s.screen);

  return (
    <div className="app-root">
      {screen === 'menu' && <MainMenu />}
      {screen === 'playing' && <GameScreen />}
    </div>
  );
}

export default App;
