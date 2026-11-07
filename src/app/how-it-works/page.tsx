export const metadata = { title: "How it works · Covered" };

export default function How() {
  return (
    <>
      <h1>Why this beats swipe-to-pay apps</h1>
      <p className="sub">Covered is built so a stranger&apos;s kindness can&apos;t be faked, skimmed or misspent.</p>
      <div className="why" style={{ marginTop: 12 }}>
        <div><b>Money goes to the biller, never the person.</b>Kills the main fraud vector of every “billionaire Tinder” clone: fake bills and cash-outs.</div>
        <div><b>Sweeps, not swipes.</b>A big giver won&apos;t swipe 10,000 times. One sentence (“all heat bills under $400 in Winnipeg”) clears a city in a tap.</div>
        <div><b>Anyone can chip in.</b>$10 counts. Bills fill from many small gifts, and sweeps finish the rest.</div>
        <div><b>Dignity by default.</b>First name and city only. Stories are optional and never ranked, so the most desperate pitch doesn&apos;t win.</div>
        <div><b>Proof of payment.</b>Every payout returns a biller confirmation number and an optional thank-you. Givers see receipts, not promises.</div>
      </div>
      <h2>What happens to your money</h2>
      <div className="panel feed">
        <div>You pay by card, Apple Pay or Google Pay through Stripe. No account needed.</div>
        <div>If someone else covers the bill a split second before you, you are refunded automatically.</div>
        <div>Every bill is read from a photo and checked by a person on our team before it goes live. Bills over $1,500 aren&apos;t accepted.</div>
        <div>Payouts to billers are processed by our team within 2 business days.</div>
        <div>A bill that is still open 7 days after its due date expires, and everyone who gave toward it is refunded.</div>
      </div>
    </>
  );
}
