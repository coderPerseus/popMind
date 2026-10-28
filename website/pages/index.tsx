import Home from '../components/Home';

// "/" shows the Chinese home page (its canonical address is /zh), as the old site sent "/" to /zh.
export default function RootPage() {
  return <Home lang="zh" />;
}
