import "server-only";
import Stripe from "stripe";

let client: Stripe | undefined;
export function stripe(): Stripe {
  return (client ??= new Stripe(process.env.STRIPE_SECRET_KEY!, { httpClient: Stripe.createFetchHttpClient() }));
}
