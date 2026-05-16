export class LoopDetector {
  private streak = 0;
  private lastSender: string | null = null;

  constructor(private threshold: number) {}

  observe(sender: string): boolean {
    if (sender === this.lastSender) {
      this.streak++;
    } else {
      this.streak = 1;
      this.lastSender = sender;
    }
    return this.streak >= this.threshold;
  }

  reset(): void {
    this.streak = 0;
    this.lastSender = null;
  }
}
