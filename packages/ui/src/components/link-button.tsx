import Link from 'next/link'

export const LinkButton = ({ href, icon, title }: { href: string; icon: React.ReactNode; title: string }) => {
    return (
        <Link
            href={href}
            target="_blank"
            className="text-white opacity-90 items-center font-medium hover:opacity-100 transition-opacity duration-200 text-[16px] px-4 py-4 rounded-md w-full max-w-[300px] flex justify-center border border-[#4D4D4D] bg-[#1A1A1A]"
        >
            {icon}
            {title}
        </Link>
    )
}
