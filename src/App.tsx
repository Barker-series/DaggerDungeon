import { useGameStore } from './store/gameStore';
import { MainMenu } from './ui/MainMenu';
import { ClassSelect } from './ui/ClassSelect';
import { GameScreen } from './ui/GameScreen';
import { DeathScreen } from './ui/DeathScreen';
import './style.css';

function App() {
  const screen = useGameStore((s) => s.screen);

  return (
    <div className="app-root">
      {screen === 'menu' && <MainMenu />}
      {screen === 'classSelect' && <ClassSelect />}
      {screen === 'playing' && <GameScreen />}
      {screen === 'dead' && <DeathScreen />}
    </div>
  );
}

export default App;
