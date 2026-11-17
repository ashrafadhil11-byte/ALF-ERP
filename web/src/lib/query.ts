import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

// Reads stay fresh for 30 s so moving between pages does not repeat the same request;
// errors the server meant (4xx) are not retried.
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 2
        }
    }
});
