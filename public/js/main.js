document.addEventListener('DOMContentLoaded', async () => {
    State.init();
    Navigation.init();
    // keep the user signed in across a page refresh (the token is kept for this tab only)
    if (await State.restore()) Navigation.navigate('VIRTUAL_CAMPUS');
    else Navigation.navigate('LOGIN');
});
