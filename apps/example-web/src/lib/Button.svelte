<script lang="ts">
	interface ButtonProps {
		className?: string;
		disabled?: boolean;
		onClick?: () => void;
	}

	let { className = '', disabled = false, onClick, children }: ButtonProps & { children: any } = $props();
</script>

<button
	class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm transition-all disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 has-[>svg]:px-3 cursor-pointer disabled:cursor-not-allowed {className}"
	{disabled}
	onclick={onClick}
>
	{@render children()}
</button>