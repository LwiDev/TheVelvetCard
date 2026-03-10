<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { wsStore } from '$lib/ws.svelte';

	let { children } = $props();

	onMount(() => wsStore.connect());
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
