import { LinkButton } from "../components/link-button";
import { GitHubIcon, YouTubeIcon, DiscordIcon } from "../icons/social-icons";

export const CTA = () => {
    return (
        <div className="flex flex-col gap-6">
            <LinkButton
                href="https://github.com/darkgrade/darkgrade"
                icon={<GitHubIcon />}
                title="Star Darkgrade on GitHub"
            />
            <LinkButton href="https://youtube.com/@KevinSchaich" icon={<YouTubeIcon />} title="Subscribe on YouTube" />
            <LinkButton href="https://discord.gg/fbDbdJv9dX" icon={<DiscordIcon />} title="Join our Discord" />
        </div>
    )
}
