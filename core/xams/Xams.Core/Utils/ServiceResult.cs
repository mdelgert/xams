using Xams.Core.Dtos;

namespace Xams.Core.Utils
{
    public static class ServiceResult
    {
        public static Response<object?> Success(object? data = null)
        {
            return new Response<object?>()
            {
                Succeeded = true,
                Data = data
            };
        }
        
        public static Response<List<string>> Success(List<string> data)
        {
            return new Response<List<string>>
            {
                Succeeded = true,
                Data = data
            };
        }
        
        public static Response<object?> Success(string friendlyMessage)
        {
            return new Response<object?>()
            {
                Succeeded = true,
                FriendlyMessage = friendlyMessage,
                Data = friendlyMessage
            };
        }

        public static Response<object?> Success(FileData fileData)
        {
            return new Response<object?>()
            {
                Succeeded = true,
                Data = fileData,
                ResponseType = ResponseType.File
            };
        }
        
        public static Response<object?> Error(object? data = null)
        {
            return new Response<object?>()
            {
                Succeeded = false,
                Data = data
            };
        }
    
        public static Response<object?> Error(string message, object? data = null)
        {
            return new Response<object?>()
            {
                Succeeded = false,
                FriendlyMessage = message,
                Data = data
            };
        }
    }
}