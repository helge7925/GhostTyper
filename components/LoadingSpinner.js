export default function LoadingSpinner() {
  return (
    <div className="flex justify-center items-center py-12">
      <div className="w-8 h-8 border-4 border-accent-purple/30 border-t-accent-purple rounded-full animate-spin" />
    </div>
  );
}
