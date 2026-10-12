import Swal from "sweetalert2";

export async function confirmDelete(message: string): Promise<boolean> {
  const result = await Swal.fire({
    title: "Are you sure?",
    text: message,
    icon: "warning",
    customClass: {
      popup: "delete-confirm-popup",
    },
    showCancelButton: true,
    confirmButtonColor: "#b34b43",
    cancelButtonColor: "#6b7280",
    confirmButtonText: "Yes, delete it",
    cancelButtonText: "Cancel",
    reverseButtons: true,
    focusCancel: true,
  });

  return result.isConfirmed;
}
