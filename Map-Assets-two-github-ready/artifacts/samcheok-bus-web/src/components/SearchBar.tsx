import { Search } from "lucide-react";

interface SearchBarProps {
  origin: string;
  destination: string;
  onClick: () => void;
}

export function SearchBar({ origin, destination, onClick }: SearchBarProps) {
  const hasRoute = origin || destination;

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="button-open-route-search"
      className="w-full flex items-center gap-3 bg-white rounded-2xl shadow-lg border border-gray-200 px-4 py-3.5 text-left hover:shadow-xl transition-shadow"
    >
      <Search className="w-5 h-5 text-gray-400 shrink-0" />
      {hasRoute ? (
        <div className="flex items-center gap-2 min-w-0 text-sm font-medium text-gray-800">
          <span className="truncate">{origin || "출발지"}</span>
          <span className="text-gray-400">→</span>
          <span className="truncate">{destination || "도착지"}</span>
        </div>
      ) : (
        <span className="text-base text-gray-400">어디로 갈까요?</span>
      )}
    </button>
  );
}
