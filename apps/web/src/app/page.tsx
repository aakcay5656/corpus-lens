import { redirect } from "next/navigation";

/** The app has no marketing surface; the root is the chat page for anyone signed in. */
export default function Home() {
  redirect("/chat");
}
