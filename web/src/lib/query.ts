import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
import { onChange } from './live';

// Reads stay fresh for 15 s so moving between pages does not repeat the same request (any save marks them out of date);
// errors the server meant (4xx) are not retried.
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 2
        }
    }
});

// after a save anywhere (this tab, Farah, another tab): cached lists are out of date — the ones on screen reload now
onChange(() => { queryClient.invalidateQueries(); });
